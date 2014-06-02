/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Suspend Tab.
 *
 * The Initial Developer of the Original Code is YUKI "Piro" Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2012-2014
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):: YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
 *                  YosukeM (Yosuke Morimoto) https://github.com/YosukeM
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var EXPORTED_SYMBOLS = ['SuspendTab'];

load('lib/WindowManager');
load('lib/prefs');
load('lib/here');
var timer = require('lib/jstimer');

var bundle = require('lib/locale')
				.get('chrome://suspendtab/locale/label.properties');

Cu.import('resource://gre/modules/Services.jsm');
if (Services.vc.compare(Services.appinfo.version, '25.0') < 0) {
	load('suspendtab-internal-24');
}
else {
	load('suspendtab-internal');
}

function SuspendTab(aWindow)
{
	this.init(aWindow);
}
SuspendTab.prototype = {
	__proto__ : require('const'),

	get debug()
	{
		return prefs.getPref(this.domain + 'debug');
	},

	get autoSuspend()
	{
		return prefs.getPref(this.domain + 'autoSuspend.enabled');
	},
	get autoSuspendTimeout()
	{
		return prefs.getPref(this.domain + 'autoSuspend.timeout') * prefs.getPref(this.domain + 'autoSuspend.timeout.factor');
	},
	get autoSuspendResetOnReload()
	{
		return prefs.getPref(this.domain + 'autoSuspend.resetOnReload');
	},
	get autoSuspendNewBackgroundTab()
	{
		return prefs.getPref(this.domain + 'autoSuspend.newBackgroundTab');
	},

	get document()
	{
		return this.window.document;
	},
	get browser()
	{
		return this.window.gBrowser;
	},
	get tabs()
	{
		return this.browser.mTabContainer.childNodes;
	},
	get tabContextPopup()
	{
		return this.document.getElementById('tabContextMenu');
	},

	get blockList()
	{
		if (!('_blockList' in this)) {
			this._blockList = prefs.getPref(this.domain + 'autoSuspend.blockList');

			if (this._blockList) {
				this._blockList = this._blockList.split(/\s+/).map(function(aItem) {
					return this._generateRegExpFromRule(aItem);
				}, this).filter(function(aRule) {
					return Boolean(aRule);
				});
			}
		}
		return this._blockList;
	},
	_generateRegExpFromRule : function(aRule)
	{
		try {
			var regexp = aRule.replace(/\./g, '\\.')
							.replace(/\?/g, '.')
							.replace(/\*/g, '.*');
			regexp = aRule.indexOf('/') < 0 ?
						regexp : '^' + regexp;
			return regexp && new RegExp(regexp, 'i');
		}
		catch(error) {
			Cu.reportError(new Error('suspendtab: invalid block rule "' + aRule + '"'));
			return null;
		}
	},

	handleEvent : function(aEvent)
	{
		switch (aEvent.type)
		{
			case 'popupshowing':
				return this.onPopupShowing(aEvent);

			case 'command':
				return this.onCommand(aEvent);

			case 'TabOpen':
				return this.onTabOpen(aEvent);

			case 'TabSelect':
				return this.onTabSelect(aEvent);

			case 'SSTabRestoring':
				return this.cancelTimer(aEvent.originalTarget);

			case 'SSTabRestored':
				return this.resume(aEvent.originalTarget);

			case 'DOMTitleChanged':
			case 'load':
				return this.onReloaded(aEvent);

			case 'unload':
				return this.destroy();
		}
	},

	observe : function(aSubject, aTopic, aData)
	{
		if (aTopic != 'nsPref:changed')
			return;

		switch (aData)
		{
			case this.domain + 'autoSuspend.blockList':
				delete this._blockList;
			case this.domain + 'autoSuspend.enabled':
			case this.domain + 'autoSuspend.timeout':
			case this.domain + 'autoSuspend.timeout.factor':
				return this.setTimers(true);
		}
	},

	onPopupShowing : function(aEvent)
	{
		if (!this.tabContextItem || aEvent.target != this.tabContextPopup)
			return;

		var isLastTab = this.tabs.length == 1;
		var tab = this.browser.mContextTab;

		let (item = this.tabContextItem) {
			if (this.isSuspended(tab)) {
				item.setAttribute('label', bundle.getString('tab.resume.label'));
				item.setAttribute('accesskey',  bundle.getString('tab.resume.accesskey'));
			}
			else {
				item.setAttribute('label', bundle.getString('tab.suspend.label'));
				item.setAttribute('accesskey',  bundle.getString('tab.suspend.accesskey'));
			}

			item.disabled = isLastTab;
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
		}

		let (item = this.tabContextAddDomainExceptionItem) {
			if (this.isBlocked(tab))
				item.setAttribute('checked', true);
			else
				item.removeAttribute('checked');
			item.disabled = !this.isBlockable(tab);
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
		}

		let sandbox = new Cu.Sandbox(
				this.window,
				{ sandboxPrototype: this.window }
			);
		this.extraMenuItems.forEach(function(aItem) {
			var availableChecker = aItem.getAttribute(this.MENUITEM_AVAILABLE);
			var available = (availableChecker ? Cu.evalInSandbox('(function() { ' + availableChecker + '})()', sandbox) : true);
			aItem.hidden = !available || !prefs.getPref(this.domain + 'menu.' + aItem.id);

			var enabledChecker = aItem.getAttribute(this.MENUITEM_ENABLED);
			var enabled = (enabledChecker ? Cu.evalInSandbox('(function() { ' + enabledChecker + '})()', sandbox) : true);
			aItem.disabled = !enabled || isLastTab;
		}, this);
	},

	onCommand : function(aEvent)
	{
		switch (aEvent.target.id)
		{
			case 'context_toggleTabSuspended':
				return this.onToggleSuspendedCommand(aEvent);

			case 'context_toggleTabSuspendException':
				return this.onToggleExceptionCommand(aEvent);

			default:
				return;
		}
	},

	onToggleSuspendedCommand : function(aEvent)
	{
		var tab = this.browser.mContextTab;
		var TST = this.browser.treeStyleTab;
		if (this.isSuspended(tab)) {
			let resumed = this.resume(tab);

			if (TST && TST.isSubtreeCollapsed(tab)) {
				TST.getDescendantTabs(tab).forEach(function(aTab) {
					resumed = resumed && this.resume(aTab);
				}, this);
			}

			if (!resumed)
				return;
		}
		else {
			let suspended = this.suspend(tab);

			if (TST && TST.isSubtreeCollapsed(tab)) {
				TST.getDescendantTabs(tab).forEach(function(aTab) {
					suspended = suspended && this.suspend(aTab);
				}, this);
			}

			if (!suspended)
				return;
		}
	},
	getNextFocusedTab : function(aTab)
	{
		var tabs = this.browser.visibleTabs;
		if (tabs.length == 1 && tabs[0] == aTab)
			tabs = this.tabs;

		// skip suspending tabs
		tabs = tabs.filter(function(aOtherTab) {
			return !this.internal.getTabState(aOtherTab);
		}, this);
		if (!tabs.length)
			return null;

		var index = Array.slice(tabs).indexOf(aTab);
		switch (prefs.getPref(this.domain + 'autoSuspend.nextFocus')) {
			default:
				let TST = this.browser.treeStyleTab;
				if (TST) {
					let nextFocused = !TST.isSubtreeCollapsed(aTab) && TST.getFirstChildTab(aTab);
					nextFocused = nextFocused || TST.getNextSiblingTab(aTab) || TST.getPreviousSiblingTab(aTab);
					if (nextFocused)
						return nextFocused;

					let tabs = Array.filter(this.tabs, function(aTab) {
							return (
								aTab.hidden &&
								!this.internal.getTabState(aOtherTab) // skip suspending tabs
							);
						}, this);
					return tabs.length ? tabs[0] : null ;
				}
			case this.NEXT_FOCUS_FOLLOWING:
				index = index > -1 && index + 1 <= tabs.length - 1 ?
						index + 1 :
						0 ;
				return tabs[index];

			case this.NEXT_FOCUS_PRECEDING:
				index = index > 1 ?
						index - 1 :
						tabs.length - 1 ;
				return tabs[index];

			case this.NEXT_FOCUS_FIRST:
				return tabs[0];

			case this.NEXT_FOCUS_LAST:
				return tabs[tabs.length - 1];
		}
	},

	onToggleExceptionCommand : function(aEvent)
	{
		var tab = this.browser.mContextTab;
		var uri = tab.linkedBrowser.currentURI;

		var list = prefs.getPref(this.domain + 'autoSuspend.blockList') || '';
		if (this.isBlocked(tab)) {
			list = list.split(/\s+/).filter(function(aRule) {
				aRule = this._generateRegExpFromRule(aRule);
				return !this.testBlockRule(aRule, uri);
			}, this).join(' ');
		}
		else {
			list = (list + ' ' + uri.host).trim();
		}
		prefs.setPref(this.domain + 'autoSuspend.blockList', list);
	},

	onTabOpen : function(aEvent)
	{
		if (!this.autoSuspendNewBackgroundTab)
			return;

		var tab = aEvent.originalTarget;
		timer.setTimeout(function(aSelf) {
			if (!tab.parentNode || tab.selected)
				return;
			aSelf.suspend(tab);
		}, 0, this);
	},

	onTabSelect : function(aEvent)
	{
		var tab = aEvent.originalTarget;
		if (this.debug)
			dump('tab '+tab._tPos+' is selected.\n');
		this.cancelTimer(tab);
		this.resume(tab);
		this.setTimers();
	},

	/**
	 * This addon handles "reload" of tabs for multiple purposes:
	 *  1. When a suspended tab is reloaded, restore the tab.
	 *  2. When a normal tab is reloaded, cancel (and reset)
	 *     the timer of "auto suspend".
	 */
	onReloaded : function(aEvent)
	{
		var w = aEvent.target.defaultView.top;
		var possiblySuspended = w.location.href == 'about:blank';
		if (!this.autoSuspendResetOnReload && !possiblySuspended)
			return;

		var tab;
		if (!Array.some(this.tabs, function(aTab) {
				if (aTab.linkedBrowser.contentWindow != w)
					return false;

				tab = aTab;
				return true;
			}, this))
			return;

		if (this.isSuspended(tab)) {
			if (
				possiblySuspended &&
				// The blank page is loaded when it is suspended too.
				// We have to handle only "reloading of already suspended" tab,
				// in other words, we must ignore "just now suspended" tab.
				tab.hasAttribute('pending')
				)
				this.resume(tab);
		}
		else {
			if (this.autoSuspendResetOnReload && !tab.selected)
				this.reserveSuspend(tab);
		}
	},

	setTimers : function(aReset)
	{
		Array.forEach(this.tabs, function(aTab) {
			if (aTab.__suspendtab__timer && !aReset)
				return;

			if (this.autoSuspend)
				this.reserveSuspend(aTab);
			else if (aReset)
				this.cancelTimer(aTab);
		}, this);
	},

	isSuspendable : function(aTab)
	{
		if (
			aTab.selected ||
			aTab.pinned ||
			aTab.hasAttribute('protected') // protected tab, by Tab Mix Plus or others
			)
			return false;

		return !this.isBlockable(aTab) || !this.isBlocked(aTab);
	},
	isBlockable : function(aTab)
	{
		var uri = aTab.linkedBrowser.currentURI;
		try {
			return Boolean(uri.host);
		}
		catch(e) {
			return false;
		}
	},
	isBlocked : function(aTab)
	{
		if (!this.blockList)
			return false;

		var uri = aTab.linkedBrowser.currentURI;
		return this.blockList.some(function(aRule) {
			return this.testBlockRule(aRule, uri);
		}, this);
	},
	testBlockRule : function(aRule, aURI)
	{
		if (aRule.source.indexOf('/') < 0) {
			try {
				return aRule.test(aURI.host);
			}
			catch(e) {
				return false;
			}
		}
		else {
			return aRule.test(aURI.spec);
		}
	},

	cancelTimers : function()
	{
		Array.forEach(this.tabs, function(aTab) {
			this.cancelTimer(aTab);
		}, this);
	},

	cancelTimer : function(aTab)
	{
		if (aTab.__suspendtab__timer) {
			if (this.debug)
				dump(' cancel timer for '+aTab._tPos+'\n');
			timer.clearTimeout(aTab.__suspendtab__timer);
			aTab.__suspendtab__timestamp = 0;
			aTab.__suspendtab__timer = null;
			this.updateTooltip(aTab);
		}
	},

	reserveSuspend : function(aTab)
	{
		var timestamp = aTab.__suspendtab__timestamp;
		this.cancelTimer(aTab);

		if (this.isSuspended(aTab) ||
			!this.isSuspendable(aTab))
			return;

		var now = Date.now();
		if (this.debug) {
			dump(' reserve suspend '+aTab._tPos+'\n');
			dump('  timestamp = '+timestamp+'\n');
			dump('  now       = '+now+'\n');
		}
		if (timestamp && now - timestamp >= this.autoSuspendTimeout) {
			dump('  => suspend now!\n');
			return this.suspend(aTab);
		}

		aTab.__suspendtab__timestamp = timestamp || now;
		aTab.__suspendtab__timer = timer.setTimeout(function(aSelf) {
			aTab.__suspendtab__timestamp = 0;
			aTab.__suspendtab__timer = null;
			if (aSelf.autoSuspend)
				aSelf.suspend(aTab);
		}, this.autoSuspendTimeout, this)

		this.updateTooltip(aTab);
	},

	updateTooltip : function(aTab)
	{
		if (!this.debug || this.isSuspended(aTab) || aTab.selected) {
			if (aTab.getAttribute('tooltiptext') &&
				aTab.getAttribute('tooltiptext') == aTab.getAttribute('suspendtab-tooltiptext'))
				aTab.setAttribute('tooltiptext', aTab.visibleLabel || aTab.label);
			aTab.removeAttribute('suspendtab-tooltiptext');
			return;
		}

		var now = aTab.__suspendtab__timestamp || Date.now();
		var date = String(new Date(now + this.autoSuspendTimeout));
		var label = aTab.visibleLabel || aTab.label;
		label = bundle.getFormattedString('toBeSuspended.tooltip', [label, date]);
		aTab.setAttribute('tooltiptext', label);
		aTab.setAttribute('suspendtab-tooltiptext', label);
		dump('  => will be suspended at '+date+'\n');
	},

	get MutationObserver()
	{
		var w = this.window;
		return w.MutationObserver || w.MozMutationObserver;
	},

	onMutation : function(aMutations, aObserver)
	{
		aMutations.forEach(function(aMutation) {
			var target = aMutation.target;
			if (target.localName != 'tab')
				return;
			this.updateTooltip(target);
		}, this);
	},

	resumeAll : function(aRestoreOnlySuspendedByMe)
	{
		this.internal.resumeAll(aRestoreOnlySuspendedByMe);
	},

	reserveGC : function()
	{
		if (this.GCTimer) return;
		this.GCTimer = timer.setTimeout(function(aSelf) {
			aSelf.GCTimer= null;

			Cu.forceGC();
			Services.obs.notifyObservers(null, 'child-gc-request', null);

			var utils = aSelf.window
						.QueryInterface(Ci.nsIInterfaceRequestor)
						.getInterface(Ci.nsIDOMWindowUtils);
			if (utils.cycleCollect) {
				utils.cycleCollect();
				Services.obs.notifyObservers(null, 'child-cc-request', null);
			}
		}, 0, this);
	},

	init : function(aWindow)
	{
		SuspendTab.instances.push(this);

		if (!SuspendTabInternal.isAvailable()) return;

		this.window = aWindow;
		this.internal = new SuspendTabInternal(aWindow);

		this.window.addEventListener('unload', this, false);
		this.window.addEventListener('TabOpen', this, false);
		this.window.addEventListener('TabSelect', this, true);
		this.window.addEventListener('SSTabRestoring', this, true);
		this.window.addEventListener('SSTabRestored', this, true);
		this.browser.addEventListener('load', this, true);
		this.browser.addEventListener('DOMTitleChanged', this, true);

		this.setTimers();

		prefs.addPrefListener(this);

		this.observer = new this.MutationObserver((function(aMutations, aObserver) {
			this.onMutation(aMutations, aObserver);
		}).bind(this));
		this.observer.observe(this.browser.tabContainer, {
			attributes      : true,
			subtree         : true,
			attributeFilter : [
				'label',
				'visibleLabel'
			]
		});

		this.initMenuItems();
	},

	initMenuItems : function()
	{
		this.tabContextPopup.addEventListener('popupshowing', this, false);

		this.tabContextItem = this.document.createElement('menuitem');
		this.tabContextItem.setAttribute('id', 'context_toggleTabSuspended');
		this.tabContextItem.addEventListener('command', this, false);

		var undoItem = this.document.getElementById('context_undoCloseTab');
		this.tabContextPopup.insertBefore(this.tabContextItem, undoItem);

		this.extraMenuItems = [];

		if ('TreeStyleTabService' in this.window) {
			let collectTreeTabs = here(/*
				var tab = gBrowser.mContextTab;
				var tabs = [tab].concat(gBrowser.treeStyleTab.getDescendantTabs(tab));
			*/);
			let (item = this.document.createElement('menuitem')) {
				this.extraMenuItems.push(item);
				item.setAttribute('id', 'context_suspendTree');
				item.setAttribute('label', bundle.getString('tab.suspendTree.label'));
				item.setAttribute('accesskey', bundle.getString('tab.suspendTree.accesskey'));
				item.setAttribute('oncommand', collectTreeTabs + here(/*
					tabs.forEach(function(aTab) {
						SuspendTab.suspend(aTab);
					});
				*/));
				item.setAttribute(this.MENUITEM_ENABLED, collectTreeTabs + here(/*
					return tabs.some(function(aTab) {
						return !SuspendTab.isSuspended(aTab);
					});
				*/));
				item.setAttribute(this.MENUITEM_AVAILABLE,
					'return gBrowser.treeStyleTab.hasChildTabs(gBrowser.mContextTab);');
				this.tabContextPopup.insertBefore(item, undoItem);
			}
			let (item = this.document.createElement('menuitem')) {
				this.extraMenuItems.push(item);
				item.setAttribute('id', 'context_resumeTree');
				item.setAttribute('label', bundle.getString('tab.resumeTree.label'));
				item.setAttribute('accesskey', bundle.getString('tab.resumeTree.accesskey'));
				item.setAttribute('oncommand', collectTreeTabs + here(/*
					tabs.forEach(function(aTab) {
						SuspendTab.resume(aTab);
					});
				*/));
				item.setAttribute(this.MENUITEM_ENABLED, collectTreeTabs + here(/*
					return tabs.some(function(aTab) {
						return SuspendTab.isSuspended(aTab);
					});
				*/));
				item.setAttribute(this.MENUITEM_AVAILABLE,
					'return gBrowser.treeStyleTab.hasChildTabs(gBrowser.mContextTab);');
				this.tabContextPopup.insertBefore(item, undoItem);
			}
		}

		this.tabContextAddDomainExceptionItem = this.document.createElement('menuitem');
		this.tabContextAddDomainExceptionItem.setAttribute('id', 'context_toggleTabSuspendException');
		this.tabContextAddDomainExceptionItem.setAttribute('label', bundle.getString('tab.exception.add.label'));
		this.tabContextAddDomainExceptionItem.setAttribute('accesskey', bundle.getString('tab.exception.add.accesskey'));
		this.tabContextAddDomainExceptionItem.setAttribute('type', 'checkbox');
		this.tabContextAddDomainExceptionItem.addEventListener('command', this, false);
		this.tabContextPopup.insertBefore(this.tabContextAddDomainExceptionItem, undoItem);
	},

	destroy : function()
	{
		if (this.window) {
			this.cancelTimers();

			this.destroyMenuItems();

			prefs.removePrefListener(this);

			this.observer.disconnect();
			delete this.observer;

			this.window.removeEventListener('unload', this, false);
			this.window.removeEventListener('TabOpen', this, false);
			this.window.removeEventListener('TabSelect', this, true);
			this.window.removeEventListener('SSTabRestoring', this, true);
			this.window.removeEventListener('SSTabRestored', this, true);
			this.browser.removeEventListener('load', this, true);
			this.browser.removeEventListener('DOMTitleChanged', this, true);

			delete this.window;
		}

		if (this.internal)
			delete this.internal;

		if (SuspendTab)
			SuspendTab.instances.splice(SuspendTab.instances.indexOf(this), 1);
	},

	destroyMenuItems : function()
	{
		this.tabContextPopup.removeEventListener('popupshowing', this, false);

		this.tabContextItem.removeEventListener('command', this, false);
		this.tabContextItem.parentNode.removeChild(this.tabContextItem);
		delete this.tabContextItem;

		this.tabContextAddDomainExceptionItem.removeEventListener('command', this, false);
		this.tabContextAddDomainExceptionItem.parentNode.removeChild(this.tabContextAddDomainExceptionItem);
		delete this.tabContextAddDomainExceptionItem;

		this.extraMenuItems.forEach(function(aItem) {
			aItem.parentNode.removeChild(aItem);
		});
		delete this.extraMenuItems;
	},


	isSuspended : function(aTab)
	{
		return this.internal.isSuspended(aTab);
	},

	suspend : function(aTab)
	{
		if (this.isSuspended(aTab))
			return true;

		if (!this.internal.suspend(aTab))
			return false;

		if (aTab.selected) {
			let nextFocused = this.getNextFocusedTab(aTab);
			if (nextFocused)
				this.browser.selectedTab = nextFocused;
		}
		this.reserveGC();

		return true;
	},

	resume : function(aTabs)
	{
		this.internal.resume(aTabs);
	}
};

SuspendTab.instances = [];

SuspendTab.resumeAll = function(aRestoreOnlySuspendedByMe) {
	this.instances.forEach(function(aInstance) {
		aInstance.resumeAll(aRestoreOnlySuspendedByMe);
	});
};

function shutdown(aReason)
{
	if (aReason == 'ADDON_DISABLE')
		SuspendTab.resumeAll(true);

	SuspendTab.instances.forEach(function(aInstance) {
		aInstance.destroy();
	});

	WindowManager = undefined;
	timer = undefined;
	bundle = undefined;
	Services = undefined;

	SuspendTab.instances = undefined;
	SuspendTab = undefined;
	SuspendTabInternal = undefined;

	shutdown = undefined;
}
