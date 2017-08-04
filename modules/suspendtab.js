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
 * Portions created by the Initial Developer are Copyright (C) 2012-2016
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):: YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
 *                  YosukeM (Yosuke Morimoto) https://github.com/YosukeM
 *                  vzvu3k6k https://github.com/vzvu3k6k
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

var bundle = require('lib/locale')
				.get('chrome://suspendtab/locale/label.properties');

var { Services } = Cu.import('resource://gre/modules/Services.jsm', {});
var { setTimeout, clearTimeout } = Cu.import('resource://gre/modules/Timer.jsm', {});

load('suspendtab-internal');

function SuspendTab(aWindow)
{
	this.init(aWindow);
}
SuspendTab.prototype = inherit(require('const'), {
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
	get autoSuspendTooManyTabs()
	{
		return prefs.getPref(this.domain + 'autoSuspend.tooManyTabs');
	},
	get maxTabsOnMemory()
	{
		return prefs.getPref(this.domain + 'autoSuspend.tooManyTabs.maxTabsOnMemory');
	},
	get autoSuspendNewBackgroundTab()
	{
		return prefs.getPref(this.domain + 'autoSuspend.newBackgroundTab');
	},
	get autoSuspendNewBackgroundTabAfterLoad()
	{
		return prefs.getPref(this.domain + 'autoSuspend.newBackgroundTab.afterLoad');
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
		return this.browser.tabContainer.childNodes;
	},
	get tabsFromOldToNew()
	{
		var tabs = [...this.tabs];
		return tabs.sort(function(aA, aB) {
			var a = aA.__suspendtab__lastFocused || aA.__suspendtab__openedAt || aA._tPos || 0;
			var b = aB.__suspendtab__lastFocused || aB.__suspendtab__openedAt || aB._tPos || 0;
			return a - b;
		});
	},
	get tabsFromNewToOld()
	{
		return this.tabsFromOldToNew.reverse();
	},
	get tabContextPopup()
	{
		return this.document.getElementById('tabContextMenu');
	},
	get contentContextPopup()
	{
		return this.document.getElementById('contentAreaContextMenu');
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
			var ruleWithScheme = this.RULE_WITH_SCHEME.test(aRule);
			var regexp = aRule.replace(/\./g, '\\.')
							.replace(/\?/g, '.')
							.replace(/\*/g, '.*');
			regexp = ruleWithScheme ? '^' + regexp : regexp ;
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
				return this.onTabRestored(aEvent);

			case this.EVENT_TYPE_TAB_LOADED:
				return this.handleReloadedTab(aEvent.originalTarget);

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
			case this.domain + 'autoSuspend.tooManyTabs':
			case this.domain + 'autoSuspend.tooManyTabs.maxTabsOnMemory':
				return this.trySuspendBackgroundTabs(true);
		}
	},

	onPopupShowing : function(aEvent)
	{
		if (aEvent.target == this.tabContextPopup)
			return this.onTabContextPopupShowing(aEvent);
		if (aEvent.target == this.contentContextPopup)
			return this.onContentContextPopupShowing(aEvent);
	},

	onTabContextPopupShowing : function(aEvent)
	{
		var isLastTab = this.tabs.length == 1;
		var tab = this.browser.mContextTab;

		{
			let item = this.tabContextItem;
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

		{
			let item = this.tabContextSuspendOthersItem;
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
		}

		{
			let item = this.tabContextAddDomainExceptionItem;
			if (this.isBlocked(tab))
				item.setAttribute('checked', true);
			else
				item.removeAttribute('checked');
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
		}

		this.showHideExtraItems(this.tabContextExtraMenuItems);
	},
	showHideExtraItems : function(aExtraItems)
	{
		var isLastTab = this.tabs.length == 1;
		var visibleItemsCount = 0;
		var sandbox = new Cu.Sandbox(
				this.window,
				{ sandboxPrototype: this.window }
			);
		aExtraItems.forEach(function(aItem) {
			var availableChecker = aItem.getAttribute(this.MENUITEM_AVAILABLE);
			var available = (availableChecker ? Cu.evalInSandbox('(function() { ' + availableChecker + '})()', sandbox) : true);
			aItem.hidden = !available || !prefs.getPref(this.domain + 'menu.' + aItem.id);
			if (!aItem.hidden)
				visibleItemsCount++;

			var enabledChecker = aItem.getAttribute(this.MENUITEM_ENABLED);
			var enabled = (enabledChecker ? Cu.evalInSandbox('(function() { ' + enabledChecker + '})()', sandbox) : true);
			aItem.disabled = !enabled || isLastTab;
		}, this);
		return visibleItemsCount > 0;
	},

	onContentContextPopupShowing : function(aEvent)
	{
		var isLastTab = this.tabs.length == 1;
		var tab = this.browser.selectedTab;
		var visibleItemsCount = 0;

		{
			let item = this.contentContextItem;
			item.disabled = isLastTab;
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
			if (!item.hidden)
				visibleItemsCount++;
		}

		{
			let item = this.contentContextSuspendOthersItem;
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
			if (!item.hidden)
				visibleItemsCount++;
		}

		{
			let item = this.contentContextAddDomainExceptionItem;
			if (this.isBlocked(tab))
				item.setAttribute('checked', true);
			else
				item.removeAttribute('checked');
			item.hidden = !prefs.getPref(this.domain + 'menu.' + item.id);
			if (!item.hidden)
				visibleItemsCount++;
		}

		var anyItemVisible = this.showHideExtraItems(this.contentContextExtraMenuItems);
		if (anyItemVisible)
			visibleItemsCount++;

		this.contentContextSeparator.hidden = visibleItemsCount == 0;
	},

	onCommand : function(aEvent)
	{
		switch (aEvent.target.id)
		{
			case 'context_toggleTabSuspended':
			case 'contentContext_suspend':
				return this.onToggleSuspendedCommand(aEvent);

			case 'context_toggleTabSuspendException':
			case 'contentContext_toggleTabSuspendException':
				return this.onToggleExceptionCommand(aEvent);

			case 'context_suspendOthers':
			case 'contentContext_suspendOthers':
				return this.onSuspendOthersCommand(aEvent);

			default:
				return;
		}
	},

	onToggleSuspendedCommand : function(aEvent)
	{
		var tab = this.browser.mContextTab || this.browser.selectedTab;
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
			if (this.debug)
				dump('<suspending toggled tab '+tab._tPos+'>\n');
			let suspended = this.suspend(tab);

			if (TST && TST.isSubtreeCollapsed(tab)) {
				TST.getDescendantTabs(tab).forEach(function(aTab) {
					if (suspended && this.debug)
						dump('  <suspending toggled descendant tab '+aTab._tPos+'>\n');
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

		if (!Array.isArray(tabs))
			tabs = [...tabs];

		var focusableTabs = tabs.filter(this.isTabFocusable, this);
		if (focusableTabs.length > 0)
			tabs = focusableTabs;

		var index = tabs.indexOf(aTab);
		switch (prefs.getPref(this.domain + 'autoSuspend.nextFocus')) {
			default:
				let TST = this.browser.treeStyleTab;
				if (TST) {
					let nextFocused = !TST.isSubtreeCollapsed(aTab) && TST.getFirstChildTab(aTab);
					nextFocused = nextFocused || TST.getNextSiblingTab(aTab) || TST.getPreviousSiblingTab(aTab);
					if (nextFocused && this.isTabFocusable(nextFocused))
						return nextFocused;

					return tabs.length ? tabs[0] : null ;
				}
			case this.NEXT_FOCUS_FOLLOWING:
				index = index > -1 && index + 1 <= tabs.length - 1 ?
						index + 1 :
						0 ;
				return tabs[index];

			case this.NEXT_FOCUS_PREVIOUSLY_FOCUSED:
				tabs = this.tabsFromOldToNew;
				index = tabs.indexOf(aTab);
				if (index == 0)
					return tabs[1];
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
	isTabFocusable : function(aTab)
	{
		return (
			!aTab.hidden &&
			!this.internal.isSuspended(aTab) &&
			!this.internal.isSuspending(aTab) &&
			!this.internal.getTabState(aTab)
		);
	},

	onToggleExceptionCommand : function(aEvent)
	{
		var tab = this.browser.mContextTab || this.browser.selectedTab;
		var uri = tab.linkedBrowser.currentURI;

		var list = prefs.getPref(this.domain + 'autoSuspend.blockList') || '';
		if (this.isBlocked(tab)) {
			list = list.split(/\s+/).filter(function(aRule) {
				aRule = this._generateRegExpFromRule(aRule);
				return !this.testBlockRule(aRule, uri);
			}, this).join(' ');
		}
		else {
			let matcher = uri.spec;
			try {
				matcher = uri.host;
			}
			catch(e) {
			}
			list = (list + ' ' + matcher).trim();
		}
		prefs.setPref(this.domain + 'autoSuspend.blockList', list);
	},

	onSuspendOthersCommand : function(aEvent)
	{
		var tab = this.browser.mContextTab || this.browser.selectedTab;
		for (let oneTab of this.tabs) {
			if (oneTab != tab) {
				if (this.debug)
					dump('<suspending other tab '+oneTab._tPos+'>\n');
				this.suspend(oneTab);
			}
		}
	},

	onTabOpen : function(aEvent)
	{
		var tab = aEvent.originalTarget;
		tab.__suspendtab__openedAt = Date.now();
		if (this.autoSuspendNewBackgroundTab) {
			if (!tab.selected &&
				this.autoSuspendNewBackgroundTabAfterLoad)
				tab.__suspendtab__suspendAfterLoad = true;

			setTimeout((function() {
				if (!tab.parentNode || tab.selected)
					return;

				if (!this.autoSuspendNewBackgroundTabAfterLoad) {
					if (this.debug)
						dump('<suspending new background tab '+tab._tPos+'>\n');
					this.suspend(tab, { newTabNotLoadedYet : true });
				}
			}).bind(this), 0);
		}
		else {
			this.trySuspendBackgroundTabs();
		}
	},

	onTabSelect : function(aEvent)
	{
		var tab = aEvent.originalTarget;
		if (this.debug)
			dump('tab '+tab._tPos+' is selected.\n');
		this.cancelTimer(tab);
		this.resume(tab);
		this.trySuspendBackgroundTabs();
		tab.__suspendtab__lastFocused = Date.now();
	},

	onTabRestored : function(aEvent)
	{
		var tab = aEvent.originalTarget;
		return this.resume(tab);
	},

	/**
	 * This addon handles "reload" of tabs for multiple purposes:
	 *  1. When a suspended tab is reloaded, restore the tab.
	 *  2. When a normal tab is reloaded, cancel (and reset)
	 *     the timer of "auto suspend".
	 */
	handleReloadedTab : function(aTab)
	{
		var possiblySuspended = aTab.linkedBrowser.currentURI.spec == 'about:blank';
		if (!this.autoSuspendResetOnReload && !possiblySuspended)
			return;

		if (this.isSuspended(aTab)) {
			let options = this.internal.getTabOptions(aTab);
			if (
				possiblySuspended &&
				// The blank page is loaded when it is suspended too.
				// We have to handle only "reloading of already suspended" tab,
				// in other words, we must ignore "just now suspended" tab.
				aTab.hasAttribute('pending')
				) {
				if (options && options.label)
					aTab.visibleLabel = aTab.label = options.label;
				if (!options || !options.newTabNotLoadedYet)
					this.resume(aTab);
			}
		}
		else {
			if (
				!aTab.pinned &&
				this.autoSuspendResetOnReload &&
				!aTab.selected
				)
				this.reserveSuspend(aTab);
		}
	},

	trySuspendBackgroundTabs : function(aReset)
	{
		var tabs = [...this.tabs];
		var tabsOnMemory = tabs.length;
		if (this.autoSuspendTooManyTabs) {
			tabs = this.tabsFromNewToOld;
			tabsOnMemory = this.maxTabsOnMemory;
			if (!this.browser.selectedTab.pinned)
				tabsOnMemory--; // decrement at first, for the current tab!
		}
		tabs.forEach(function(aTab) {
			if (!this.isSuspendable(aTab))
				return;
			if (this.isSuspended(aTab) && !aReset)
				return;
			if (
				!aTab.__suspendtab__timer ||
				aReset ||
				aTab.pinned
				) {
				if (!aTab.pinned && this.autoSuspend)
					this.reserveSuspend(aTab);
				else if (aTab.pinned || aReset)
					this.cancelTimer(aTab);
			}
			if (!aTab.pinned && !aTab.selected) {
				tabsOnMemory--;
				if (tabsOnMemory < 0) {
					if (this.debug)
						dump('<suspending too many tab '+aTab._tPos+'>\n');
					this.suspend(aTab);
				}
			}
		}, this);
	},

	isSuspendable : function(aTab)
	{
		if (
			aTab.selected ||
			aTab.pinned ||
			aTab.hasAttribute('protected') || // protected tab, by Tab Mix Plus or others ||
			!this.internal.isSuspendable(aTab)
			)
			return false;

		return !this.isBlocked(aTab);
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
	RULE_WITH_SCHEME : /^[^:]+:/,
	SCHEME_PART_MATCHER : /^[^:]+(?:\/\/)?/,
	testBlockRule : function(aRule, aURI)
	{
		if (this.RULE_WITH_SCHEME.test(aRule.source)) {
			return aRule.test(aURI.spec);
		}
		else {
			try {
				let specWithoutScheme = aURI.spec.replace(this.SCHEME_PART_MATCHER);
				return aRule.test(specWithoutScheme);
			}
			catch(e) {
				return false;
			}
		}
	},

	cancelTimers : function()
	{
		for (let tab of this.tabs)
		{
			this.cancelTimer(tab);
		}
	},

	cancelTimer : function(aTab)
	{
		if (aTab.__suspendtab__timer) {
			if (this.debug)
				dump(' cancel timer for '+aTab._tPos+'\n');
			clearTimeout(aTab.__suspendtab__timer);
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
			if (this.debug)
				dump('<suspending expired tab '+aTab._tPos+'>\n');
			return this.suspend(aTab);
		}

		aTab.__suspendtab__timestamp = timestamp || now;
		aTab.__suspendtab__timer = setTimeout((function() {
			if (!aTab.parentNode)
				return;
			aTab.__suspendtab__timestamp = 0;
			aTab.__suspendtab__timer = null;
			if (!aTab.selected && this.autoSuspend) {
				if (this.debug)
					dump('<suspending expired tab '+tab._tPos+' with timer>\n');
				this.suspend(aTab);
			}
		}).bind(this), this.autoSuspendTimeout)

		this.updateTooltip(aTab);
	},

	updateTooltip : function(aTab)
	{
		if (!this.debug || this.isSuspended(aTab) || aTab.selected) {
			if (aTab.getAttribute('tooltiptext') &&
				aTab.getAttribute('tooltiptext') == aTab.getAttribute('suspendtab-tooltiptext'))
				aTab.removeAttribute('tooltiptext');
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
		return Promise.all([...this.tabs].map(function(aTab) {
			this.cancelTimer(aTab);
			if (!aRestoreOnlySuspendedByMe ||
				aTab.getAttribute(this.SUSPENDED) == 'true')
				return this.resume(aTab);
		}, this));
	},

	reserveGC : function()
	{
		if (this.GCTimer) return;
		this.GCTimer = setTimeout((function() {
			this.GCTimer= null;

			Cu.forceGC();
			Services.obs.notifyObservers(null, 'child-gc-request', null);

			var utils = this.window
						.QueryInterface(Ci.nsIInterfaceRequestor)
						.getInterface(Ci.nsIDOMWindowUtils);
			if (utils.cycleCollect) {
				utils.cycleCollect();
				Services.obs.notifyObservers(null, 'child-cc-request', null);
			}
		}).bind(this), 0);
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
		this.window.addEventListener(this.EVENT_TYPE_TAB_LOADED, this, true);

		this.trySuspendBackgroundTabs();

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
		this.contentContextPopup.addEventListener('popupshowing', this, false);

		this.tabContextItem = this.document.createElement('menuitem');
		this.tabContextItem.setAttribute('id', 'context_toggleTabSuspended');
		this.tabContextItem.addEventListener('command', this, false);

		var undoCloseTabItem = this.document.getElementById('context_undoCloseTab');
		this.tabContextPopup.insertBefore(this.tabContextItem, undoCloseTabItem);

		this.contentContextSeparator = this.document.createElement('menuseparator');
		this.contentContextSeparator.setAttribute('id', 'contentContext_suspend_separator');
		this.contentContextPopup.appendChild(this.contentContextSeparator);

		this.contentContextItem = this.document.createElement('menuitem');
		this.contentContextItem.setAttribute('id', 'contentContext_suspend');
		this.contentContextItem.setAttribute('label', bundle.getString('tab.suspend.label'));
		this.contentContextItem.setAttribute('accesskey',  bundle.getString('tab.suspend.accesskey'));
		this.contentContextItem.addEventListener('command', this, false);
		this.contentContextPopup.appendChild(this.contentContextItem);


		this.tabContextExtraMenuItems = [];
		this.contentContextExtraMenuItems = [];

		if ('TreeStyleTabService' in this.window) {
			let collectTreeTabs = here(/*
				var tab = gBrowser.mContextTab || gBrowser.selectedTab;
				var tabs = [tab].concat(gBrowser.treeStyleTab.getDescendantTabs(tab));
			*/);
			{
				let item = this.document.createElement('menuitem');
				this.tabContextExtraMenuItems.push(item);
				item.setAttribute('id', 'context_suspendTree');
				item.setAttribute('label', bundle.getString('tab.suspendTree.label'));
				item.setAttribute('accesskey', bundle.getString('tab.suspendTree.accesskey'));
				item.setAttribute('oncommand', collectTreeTabs + here(/*
					tabs.forEach(function(aTab) {
						if (SuspendTab.debug)
							dump('<suspending tree '+aTab._tPos+'>\n');
						SuspendTab.suspend(aTab);
					});
				*/));
				item.setAttribute(this.MENUITEM_ENABLED, collectTreeTabs + here(/*
					return tabs.some(function(aTab) {
						return !SuspendTab.isSuspended(aTab);
					});
				*/));
				item.setAttribute(this.MENUITEM_AVAILABLE,
					'return gBrowser.treeStyleTab.hasChildTabs(gBrowser.mContextTab || gBrowser.selectedTab);');
				this.tabContextPopup.insertBefore(item, undoCloseTabItem);

				let contentItem = item.cloneNode(true);
				this.contentContextExtraMenuItems.push(contentItem);
				contentItem.setAttribute('id', 'contentContext_suspendTree');
				this.contentContextPopup.appendChild(contentItem);
			}
			{
				let item = this.document.createElement('menuitem');
				this.tabContextExtraMenuItems.push(item);
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
					'return gBrowser.treeStyleTab.hasChildTabs(gBrowser.mContextTab || gBrowser.selectedTab);');
				this.tabContextPopup.insertBefore(item, undoCloseTabItem);

				let contentItem = item.cloneNode(true);
				this.contentContextExtraMenuItems.push(contentItem);
				contentItem.setAttribute('id', 'contentContext_resumeTree');
				this.contentContextPopup.appendChild(contentItem);
			}
		}

		this.tabContextSuspendOthersItem = this.document.createElement('menuitem');
		this.tabContextSuspendOthersItem.setAttribute('id', 'context_suspendOthers');
		this.tabContextSuspendOthersItem.setAttribute('label', bundle.getString('tab.suspendOthers.label'));
		this.tabContextSuspendOthersItem.setAttribute('accesskey', bundle.getString('tab.suspendOthers.accesskey'));
		this.tabContextSuspendOthersItem.addEventListener('command', this, false);
		this.tabContextPopup.insertBefore(this.tabContextSuspendOthersItem, undoCloseTabItem);

		this.contentContextSuspendOthersItem = this.tabContextSuspendOthersItem.cloneNode(true);
		this.contentContextSuspendOthersItem.setAttribute('id', 'contentContext_suspendOthers');
		this.contentContextSuspendOthersItem.addEventListener('command', this, false);
		this.contentContextPopup.appendChild(this.contentContextSuspendOthersItem);


		this.tabContextAddDomainExceptionItem = this.document.createElement('menuitem');
		this.tabContextAddDomainExceptionItem.setAttribute('id', 'context_toggleTabSuspendException');
		this.tabContextAddDomainExceptionItem.setAttribute('label', bundle.getString('tab.exception.add.label'));
		this.tabContextAddDomainExceptionItem.setAttribute('accesskey', bundle.getString('tab.exception.add.accesskey'));
		this.tabContextAddDomainExceptionItem.setAttribute('type', 'checkbox');
		this.tabContextAddDomainExceptionItem.addEventListener('command', this, false);
		this.tabContextPopup.insertBefore(this.tabContextAddDomainExceptionItem, undoCloseTabItem);

		this.contentContextAddDomainExceptionItem = this.tabContextAddDomainExceptionItem.cloneNode(true);
		this.contentContextAddDomainExceptionItem.setAttribute('id', 'contentContext_toggleTabSuspendException');
		this.contentContextAddDomainExceptionItem.addEventListener('command', this, false);
		this.contentContextPopup.appendChild(this.contentContextAddDomainExceptionItem);
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
			this.window.removeEventListener(this.EVENT_TYPE_TAB_LOADED, this, true);

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
		this.contentContextPopup.removeEventListener('popupshowing', this, false);

		[
			'tabContextItem',
			'contentContextItem',
			'tabContextSuspendOthersItem',
			'contentContextSuspendOthersItem',
			'tabContextAddDomainExceptionItem',
			'contentContextAddDomainExceptionItem'
		].forEach(function(aKey) {
			this[aKey].removeEventListener('command', this, false);
			this[aKey].parentNode.removeChild(this[aKey]);
			delete this[aKey];
		}, this);

		[this.contentContextSeparator]
			.concat(this.tabContextExtraMenuItems)
			.concat(this.contentContextExtraMenuItems)
			.forEach(function(aItem) {
			aItem.parentNode.removeChild(aItem);
		});
		delete this.contentContextSeparator;
		delete this.tabContextExtraMenuItems;
		delete this.contentContextExtraMenuItems;
	},


	isSuspended : function(aTab)
	{
		return (
			this.internal &&
			!this.internal.destroyed &&
			this.internal.isSuspended(aTab)
		);
	},

	isSuspending : function(aTab)
	{
		return (
			this.internal &&
			!this.internal.destroyed &&
			this.internal.isSuspending(aTab)
		);
	},

	suspend : function(aTab, aOptions)
	{
		if (this.isSuspended(aTab))
			return true;

		if (!this.internal ||
			this.internal.destroyed)
			return false;

		return this.internal.suspend(aTab, aOptions)
			.then((function() {
				if (!this.window) // service already destroyed
					return;
				if (aTab.selected) {
					let nextFocused = this.getNextFocusedTab(aTab);
					if (nextFocused)
						this.browser.selectedTab = nextFocused;
				}
				this.reserveGC();

				return true;
			}).bind(this));
	},

	resume : function(aTabs)
	{
		return this.internal &&
			!this.internal.destroyed &&
				this.internal.resume(aTabs);
	}
});

SuspendTab.instances = [];

SuspendTab.resumeAll = function(aRestoreOnlySuspendedByMe) {
	return Promise.all(this.instances.map(function(aInstance) {
		return aInstance.resumeAll(aRestoreOnlySuspendedByMe);
	}));
};

function shutdown(aReason)
{
	if (aReason == 'ADDON_DISABLE')
		return SuspendTab.resumeAll(true)
				.then(shutdownPostProcess);
	else
		return shutdownPostProcess();
}
function shutdownPostProcess(aReason)
{
	return Promise.all(SuspendTab.instances.map(function(aInstance) {
		return aInstance.destroy(aReason == 'ADDON_DISABLE');
	}))
	.then(function() {
	SuspendTab.instances = [];

	WindowManager = undefined;
	setTimeout = clearTimeout = undefined;
	bundle = undefined;
	Services = undefined;

	SuspendTab.instances = undefined;
	SuspendTab = undefined;
	SuspendTabInternal = undefined;

	shutdown = undefined;
	shutdownPostProcess = undefined;
	});
}
