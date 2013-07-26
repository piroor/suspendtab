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
 * Portions created by the Initial Developer are Copyright (C) 2012-2013
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

var SS = Cc['@mozilla.org/browser/sessionstore;1']
			.getService(Ci.nsISessionStore);

var internalSS = (function() {;
	var ns = {
			atob : function(aInput) { return WindowManager.getWindow('navigator:browser').atob(aInput); },
			btoa : function(aInput) { return WindowManager.getWindow('navigator:browser').btoa(aInput); }
		};
	try {
		Cc['@mozilla.org/moz/jssubscript-loader;1']
			.getService(Ci.mozIJSSubScriptLoader)
			.loadSubScript('resource:///modules/sessionstore/SessionStore.jsm', ns);
		if (ns.SessionStoreInternal._initPrefs)
			ns.SessionStoreInternal._initPrefs();
		return ns.SessionStoreInternal;
	}
	catch(e) {
		try {
			Cc['@mozilla.org/moz/jssubscript-loader;1']
				.getService(Ci.mozIJSSubScriptLoader)
				.loadSubScript('resource://gre/components/nsSessionStore.js', ns);
			return new ns.SessionStoreService();
		}
		catch(e) {
			return null;
		}
	}
})();

function isInternalAPIsAvailable() {
	if (!internalSS) {
		Components.utils.reportError(new Error('suspendtab: Failed to load internal SessionStore service'));
		return false;
	}
	if (!internalSS.restoreDocument) {
		Components.utils.reportError(new Error('suspendtab: SessionStore service does not have restoreDocument() method'));
		return false;
	}
	if (!internalSS._deserializeHistoryEntry) {
		Components.utils.reportError(new Error('suspendtab: SessionStore service does not have _deserializeHistoryEntry() method'));
		return false;
	}
	return true;
}

var fullStates = {};

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
	get saferSuspend()
	{
		return prefs.getPref(this.domain + 'saferSuspend');
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
					try {
						var regexp = aItem.replace(/\./g, '\\.')
										.replace(/\?/g, '.')
										.replace(/\*/g, '.*');
						regexp = aItem.indexOf('/') < 0 ?
									'\\b' + regexp + '$' : '^' + regexp;
						return regexp && new RegExp(regexp, 'i');
					}
					catch(error) {
						Components.utils.reportError(new Error('suspendtab: invalid block rule "' + aItem + '"'));
						return null;
					}
				}).filter(function(aRule) {
					return !!aRule;
				});
			}
		}
		return this._blockList;
	},

	handleEvent : function(aEvent)
	{
		switch (aEvent.type)
		{
			case 'popupshowing':
				return this.onPopupShowing(aEvent);

			case 'command':
				return this.onCommand(aEvent);

			case 'TabSelect':
				return this.onTabSelect(aEvent);

			case 'TabClose':
				return this.onTabClose(aEvent);

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

		var tab = this.browser.mContextTab;
		var item = this.tabContextItem;
		if (this.isSuspended(tab)) {
			item.setAttribute('label', bundle.getString('tab.resume.label'));
			item.setAttribute('accesskey',  bundle.getString('tab.resume.accesskey'));
		}
		else {
			item.setAttribute('label', bundle.getString('tab.suspend.label'));
			item.setAttribute('accesskey',  bundle.getString('tab.suspend.accesskey'));
		}

		var isNoOtherTab = this.tabs.length == 1;
		if (isNoOtherTab) {
			item.setAttribute('disabled', true);
		}
		else {
			item.removeAttribute('disabled');
		}

		let sandbox = new Cu.Sandbox(
				this.window,
				{ sandboxPrototype: this.window }
			);
		this.extraMenuItems.forEach(function(aItem) {
			var availableChecker = aItem.getAttribute(this.MENUITEM_AVAILABLE);
			var available = (availableChecker ? Cu.evalInSandbox('(function() { ' + availableChecker + '})()', sandbox) : true);
			if (available && prefs.getPref(this.domain + 'menu.' + aItem.id))
				aItem.removeAttribute('hidden');
			else
				aItem.setAttribute('hidden', true);

			var enabledChecker = aItem.getAttribute(this.MENUITEM_ENABLED);
			var enabled = (enabledChecker ? Cu.evalInSandbox('(function() { ' + enabledChecker + '})()', sandbox) : true);
			if (enabled && !isNoOtherTab)
				aItem.removeAttribute('disabled');
			else
				aItem.setAttribute('disabled', true);
		}, this);
	},

	onCommand : function(aEvent)
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
		var TST = this.browser.treeStyleTab;
		if (TST) {
			let nextFocused = !TST.isSubtreeCollapsed(aTab) && TST.getFirstChildTab(aTab);
			nextFocused = nextFocused || TST.getNextSiblingTab(aTab) || TST.getPreviousSiblingTab(aTab);
			if (nextFocused)
				return nextFocused;

			let tabs = Array.filter(this.tabs, function(aTab) {
					return (
						aTab.hidden &&
						!SS.getTabValue(aOtherTab, this.STATE) // skip suspending tabs
					);
				});
			return tabs.length ? tabs[0] : null ;
		}

		var tabs = this.browser.visibleTabs;
		if (tabs.length == 1 && tabs[0] == aTab)
			tabs = this.tabs;

		// skip suspending tabs
		tabs = tabs.filter(function(aOtherTab) {
			return !SS.getTabValue(aOtherTab, this.STATE);
		}, this);
		if (!tabs.length)
			return null;

		var index = Array.slice(tabs).indexOf(aTab);
		index = index > -1 && index + 1 <= tabs.length - 1 ?
				index + 1 :
				0 ;

		return tabs[index];
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

	onTabClose : function(aEvent)
	{
		var tab = aEvent.originalTarget;
		var id = tab.getAttribute('linkedpanel');
		if (id in fullStates)
			delete fullStates[id];
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
		if (aTab.selected) return false;

		if (aTab.pinned) return false;

		if (this.blockList) {
			let uri = aTab.linkedBrowser.currentURI;
			let domain = this._getDomainFromURI(uri);
			if (this.blockList.some(function(aRule) {
					var target = aRule.source.indexOf('/') < 0 ? domain : uri.spec;
					return aRule.test(target);
				}))
				return false;
		}

		return true;
	},
	_getDomainFromURI : function (aURI) 
	{
		if (!aURI) return null;

		var spec = aURI.spec;
		var domainMatchResult = spec.match(/^\w+:(?:\/\/)?([^:\/]+)/);
		return domainMatchResult ?
				domainMatchResult[1] :
				null ;
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

			if (this.debug && !this.isSuspended(aTab))
				aTab.setAttribute('tooltiptext', aTab.label);
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

		if (this.debug) {
			let date = (new Date(now + this.autoSuspendTimeout));
			aTab.setAttribute('tooltiptext', aTab.label +' (to be suspended at '+date+')');
			dump('  => will be suspended at '+date+'\n');
		}

		aTab.__suspendtab__timestamp = timestamp || now;
		aTab.__suspendtab__timer = timer.setTimeout(function(aSelf) {
			aTab.__suspendtab__timestamp = 0;
			aTab.__suspendtab__timer = null;
			if (aSelf.autoSuspend)
				aSelf.suspend(aTab);
		}, this.autoSuspendTimeout, this)
	},

	resumeAll : function(aRestoreOnlySuspendedByMe)
	{
		Array.forEach(this.tabs, function(aTab) {
			this.cancelTimer(aTab);
			if (!aRestoreOnlySuspendedByMe ||
				aTab.getAttribute(this.SUSPENDED) == 'true')
				this.resume(aTab);
		}, this);
	},

	reserveGC : function()
	{
		if (this.GCTimer) return;
		this.GCTimer = timer.setTimeout(function(aSelf) {
			aSelf.GCTimer= null;

			const ObserverService = Cc['@mozilla.org/observer-service;1']
									.getService(Ci.nsIObserverService);

			Components.utils.forceGC();
			ObserverService.notifyObservers(null, 'child-gc-request', null);

			var utils = aSelf.window
						.QueryInterface(Ci.nsIInterfaceRequestor)
						.getInterface(Ci.nsIDOMWindowUtils);
			if (utils.cycleCollect) {
				utils.cycleCollect();
				ObserverService.notifyObservers(null, 'child-cc-request', null);
			}
		}, 0, this);
	},

	init : function(aWindow)
	{
		SuspendTab.instances.push(this);

		if (!isInternalAPIsAvailable()) return;

		this.window = aWindow;

		this.window.addEventListener('unload', this, false);
		this.window.addEventListener('TabSelect', this, true);
		this.window.addEventListener('TabClose', this, true);
		this.window.addEventListener('SSTabRestoring', this, true);
		this.window.addEventListener('SSTabRestored', this, true);
		this.browser.addEventListener('load', this, true);
		this.browser.addEventListener('DOMTitleChanged', this, true);

		this.setTimers();

		prefs.addPrefListener(this);

		this.initMenuItems();
	},

	initMenuItems : function()
	{
		this.tabContextItem = this.document.createElement('menuitem');
		this.tabContextItem.setAttribute('id', 'context_toggleTabSuspended');
		this.tabContextItem.addEventListener('command', this, false);

		var undoItem = this.document.getElementById('context_undoCloseTab');
		this.tabContextPopup.insertBefore(this.tabContextItem, undoItem);
		this.tabContextPopup.addEventListener('popupshowing', this, false);

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
	},

	destroy : function()
	{
		if (this.window) {
			this.cancelTimers();

			this.destroyMenuItems();

			prefs.removePrefListener(this);

			this.window.removeEventListener('unload', this, false);
			this.window.removeEventListener('TabSelect', this, true);
			this.window.removeEventListener('TabClose', this, true);
			this.window.removeEventListener('SSTabRestoring', this, true);
			this.window.removeEventListener('SSTabRestored', this, true);
			this.browser.removeEventListener('load', this, true);
			this.browser.removeEventListener('DOMTitleChanged', this, true);

			delete this.window;
		}

		delete this._SessionStoreNS;

		if (SuspendTab)
			SuspendTab.instances.splice(SuspendTab.instances.indexOf(this), 1);
	},

	destroyMenuItems : function()
	{
		this.tabContextPopup.removeEventListener('popupshowing', this, false);
		this.tabContextItem.removeEventListener('command', this, false);
		this.tabContextItem.parentNode.removeChild(this.tabContextItem);
		delete this.tabContextItem;

		this.extraMenuItems.forEach(function(aItem) {
			aItem.parentNode.removeChild(aItem);
		});
		delete this.extraMenuItems;
	},


	isSuspended : function(aTab)
	{
		return this.isSuspendedBySelf(aTab) || this.isSuspendedBySS(aTab);
	},

	isSuspendedBySelf : function(aTab)
	{
		return SS.getTabValue(aTab, this.STATE);
	},

	isSuspendedBySS : function(aTab)
//	isTabNeedToBeRestored: function(aTab)
	{
		var browser = aTab.linkedBrowser;
		// Firefox 25 and later. See: https://bugzilla.mozilla.org/show_bug.cgi?id=867142
		if (this.TabRestoreStates &&
			this.TabRestoreStates.has(browser))
			return this.TabRestoreStates.isNeedsRestore(browser);

		return browser.__SS_restoreState == 1;
	},
	get TabRestoreStates() {
		return this.SessionStoreNS.TabRestoreStates;
	},
	get SessionStoreNS() {
		if (!this._SessionStoreNS) {
			try {
				// resource://app/modules/sessionstore/SessionStore.jsm ?
				this._SessionStoreNS = Components.utils.import('resource:///modules/sessionstore/SessionStore.jsm', {});
			}
			catch(e) {
				this._SessionStoreNS = {};
			}
		}
		return this._SessionStoreNS;
	},

	suspend : function(aTab)
	{
		if (this.isSuspended(aTab))
			return true;

		let (event = this.document.createEvent('Events')) {
			event.initEvent(this.EVENT_TYPE_SUSPENDING, true, true);
			if (!aTab.dispatchEvent(event))
				return false;
		}

		if (this.debug)
			dump(' suspend '+aTab._tPos+'\n');

		var label = aTab.label;

		// First, get the current tab state via the genuine step.
		// We store it to the session data permanently.
		var state = SS.getTabState(aTab);
		state = JSON.parse(state);
		// We only need minimum data required to restore the session history,
		// so drop needless information.
		var partialState = {
			entries   : state.entries,
			storage   : state.storage || null,
			index     : state.index,
			pageStyle : state.pageStyle || null
		};
		SS.setTabValue(aTab, this.STATE, JSON.stringify(partialState));

		// If possible, we should use full tab state including sensitive data.
		// Store it to the volatile storage instaed of the session data, for privacy.
		if (internalSS._collectTabData) {
			let state = internalSS._collectTabData(aTab, true);
			if (internalSS._updateTextAndScrollDataForTab)
				internalSS._updateTextAndScrollDataForTab(this.window, aTab.linkedBrowser, state, true);
			fullStates[aTab.getAttribute('linkedpanel')] = JSON.stringify({
				entries   : state.entries,
				storage   : state.storage || null,
				index     : state.index,
				pageStyle : state.pageStyle || null
			});
		}

		// OK, let's destroy the current session history!
		var browser = aTab.linkedBrowser;
		var SHistory = browser.sessionHistory;
		var uri = browser.currentURI.clone();
		var self = this;
		browser.addEventListener('load', function() {
			browser.removeEventListener('load', arguments.callee, true);

			aTab.setAttribute('label', label);
			if (self.debug)
				aTab.setAttribute('tooltiptext', label +' (suspended)');

			// Because Firefox sets the default favicon on this event loop,
			// we have to reset the favicon in the next loop.
			timer.setTimeout(function() {
				aTab.setAttribute('image', state.attributes.image);
			}, 0);

			browser.docShell.setCurrentURI(uri);
			browser.contentDocument.title = label;

			// Don't purge all histories - leave the last one!
			// The SS module stores the title of the history entry
			// as the title of the restored tab.
			// If there is no history entry, Firefox will restore
			// the tab with the default title (the URI of the page).
			if (SHistory.count > 1) SHistory.PurgeHistory(SHistory.count - 1);

			if (self.saferSuspend) {
				if (self.debug)
					dump(' => ready to restore '+aTab._tPos+'\n');
				self.readyToResume(aTab);
			}

			aTab.setAttribute('pending', true);
			aTab.setAttribute(self.SUSPENDED, true);

			if (aTab.selected) {
				let nextFocused = self.getNextFocusedTab(aTab);
				if (nextFocused)
					self.browser.selectedTab = nextFocused;
			}

			let (event = self.document.createEvent('Events')) {
				event.initEvent(self.EVENT_TYPE_SUSPENDED, true, false);
				aTab.dispatchEvent(event);
			}
		}, true);
		// Load a blank page to clear out the current history entries.
		browser.loadURI('about:blank');

		this.reserveGC();

		return true;
	},

	resume : function(aTabs)
	{
		if (aTabs instanceof Ci.nsIDOMElement) aTabs = [aTabs];
		var idMap = { used : {} };
		var docIdentMap = {};
		aTabs.forEach(function(aTab) {
			this.resumeOne(aTab, idMap, docIdentMap);
		}, this);
	},

	resumeOne : function(aTab, aIdMap, aDocIdentMap)
	{
		if (!this.isSuspended(aTab))
			return true;

		if (this.isSuspendedBySS(aTab)) {
			// Reloading action resumes the pending restoration.
			// This will fire "SSTabRestored" event, then this method
			// will be called again to restore actual history entries.
			aTab.linkedBrowser.reload();
			return true;
		}

		let (event = this.document.createEvent('Events')) {
			event.initEvent(this.EVENT_TYPE_RESUMING, true, true);
			if (!aTab.dispatchEvent(event))
				return false;
		}

		this.readyToResume(aTab, aIdMap, aDocIdentMap);

		var state = this.getTabState(aTab, true);
		if (!state)
			return true;

		var index = aTab[this.INDEX];

		delete aTab[this.INDEX];
		delete aTab[this.READY];

		if (index > -1) {
			let self = this;
			let browser = aTab.linkedBrowser;
			let SHistory = browser.sessionHistory
							.QueryInterface(Ci.nsISHistory)
							.QueryInterface(Ci.nsISHistoryInternal);
			browser.addEventListener('load', function(aEvent) {
				if (
					!aEvent ||
					!aEvent.originalTarget ||
					!aEvent.originalTarget.defaultView ||
					aEvent.originalTarget.defaultView != browser.contentWindow
					)
					return;

				browser.removeEventListener('load', arguments.callee, true);

				// Set dummy "tab" because restoreDocument() fires
				// the SSTabRestored event. We don't need it.
				browser.__SS_restore_tab = {
					ownerDocument : aTab.ownerDocument,
					dispatchEvent : function() {}
				};
				// This is required to restore form data.
				browser.__SS_restore_data = state.entries[index];
				if (state.pageStyle)
					browser.__SS_restore_pageStyle = state.pageStyle;

				// Restore form data and scrolled positions.
				internalSS.restoreDocument(browser.ownerDocument.defaultView, browser, aEvent);

				aTab.removeAttribute('pending');
				aTab.removeAttribute(self.SUSPENDED);

				let event = self.document.createEvent('Events');
				event.initEvent(self.EVENT_TYPE_RESUMED, true, false);
				aTab.dispatchEvent(event);
			}, true);

			try {
				// This action loads the page to the RAM, then
				// Firefox starts to build DOM tree for the page.
				SHistory.getEntryAtIndex(index, true);
				SHistory.reloadCurrentEntry();
			}
			catch(e) {
				dump(e+'\n');
			}
		}
		else {
			let event = this.document.createEvent('Events');
			event.initEvent(this.EVENT_TYPE_RESUMED, true, false);
			aTab.dispatchEvent(event);
		}

		if (this.debug)
			aTab.setAttribute('tooltiptext', aTab.label);
	},

	getTabState : function(aTab, aClear)
	{
		var state = SS.getTabValue(aTab, this.STATE);
		if (!state)
			return null;

		if (aClear)
			SS.setTabValue(aTab, this.STATE, '');

		// If there is a full tab state in the volatile storage, use it.
		var id = aTab.getAttribute('linkedpanel');
		if (id in fullStates) {
			state = fullStates[id];
			if (aClear)
				delete fullStates[id];
		}

		return JSON.parse(state);
	},

	// This restores history entries, but they don't eat the RAM
	// because Firefox doesn't build DOM tree until they are actually loaded.
	readyToResume : function(aTab, aIdMap, aDocIdentMap)
	{
		if (!this.isSuspended(aTab) ||
			aTab[this.READY])
			return true;

		if (this.isSuspendedBySS(aTab))
			return true;

		var state = this.getTabState(aTab);
		if (!state)
			return true;

		// First, clear all existing information.
		// We recycle this tab to load session information.
		var browser = aTab.linkedBrowser;
		var SHistory = browser.sessionHistory
						.QueryInterface(Ci.nsISHistory)
						.QueryInterface(Ci.nsISHistoryInternal);
		if (SHistory.count > 0)
			SHistory.PurgeHistory(SHistory.count);

		// OK, let's restore the tab!
		browser.stop();

		var index = (state.index || state.entries.length) - 1;
		if (index >= state.entries.length)
			index = state.entries.length - 1;

		let current = state.entries[index] || null;
		let uri = current && current.url || null;
		browser.userTypedValue = uri;


		aIdMap = aIdMap || { used : {} };
		aDocIdentMap = aDocIdentMap || {};
		state.entries.forEach(function(aEntry) {
			SHistory.addEntry(internalSS._deserializeHistoryEntry(aEntry, aIdMap, aDocIdentMap), true);
		});

		/*
		// We don't have to restore session storage because we didn't clear it
		// and it is restoed on the startup, by Firefox itself.
		if (internalSS._deserializeSessionStorage &&
			state.storage &&
			browser.docShell instanceof Ci.nsIDocShell)
			internalSS._deserializeSessionStorage(state.storage, browser.docShell);
		*/

		aTab[this.READY] = true;
		aTab[this.INDEX] = index;

		return true;
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

	SS = undefined;
	internalSS = undefined;
	fullStates = undefined;

	SuspendTab.instances = undefined;
	SuspendTab = undefined;

	shutdown = undefined;
}
