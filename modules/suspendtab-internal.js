/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ['SuspendTabInternal'];

load('lib/prefs');
load('lib/here');

var SS = Cc['@mozilla.org/browser/sessionstore;1']
			.getService(Ci.nsISessionStore);

var { Services } = Cu.import('resource://gre/modules/Services.jsm', {});
var { setTimeout, clearTimeout } = Cu.import('resource://gre/modules/Timer.jsm', {});

var { SessionStoreInternal, TabRestoreQueue } = Cu.import('resource:///modules/sessionstore/SessionStore.jsm', {});
var TAB_STATE_NEEDS_RESTORE = 1;
var TAB_STATE_RESTORING = 2;
var TAB_STATE_WILL_RESTORE = 3;
//var { TabRestoreStates } = Cu.import('resource:///modules/sessionstore/SessionStore.jsm', {});
var { TabState } = Cu.import('resource:///modules/sessionstore/TabState.jsm', {});
var { TabStateCache } = Cu.import('resource:///modules/sessionstore/TabStateCache.jsm', {});
try {
	var { TabStateFlusher } = Cu.import('resource:///modules/sessionstore/TabStateFlusher.jsm', {});
}
catch(e) {
	// for old Firefox
	var TabStateFlusher;
}

function isInternalAPIsAvailable() {
	if (!SessionStoreInternal) {
		Cu.reportError(new Error('suspendtab: Failed to load SessionStoreInternal'));
		return false;
	}
	if (!SessionStoreInternal.restoreTabContent) {
		Cu.reportError(new Error('suspendtab: SessionStoreInternal does not have restoreTabContent() method'));
		return false;
	}
	if (
		typeof SessionStoreInternal.startNextEpoch == 'undefined') {
		if (typeof SessionStoreInternal._nextRestoreEpoch == 'undefined') { // for old Firefox
			Cu.reportError(new Error('suspendtab: SessionStoreInternal does not have startNextEpoch or _nextRestoreEpoch'));
			return false;
		}
		if (typeof SessionStoreInternal._browserEpochs == 'undefined') {
			Cu.reportError(new Error('suspendtab: SessionStoreInternal does not have _browserEpochs'));
			return false;
		}
	}

	if (!TabState) {
		Cu.reportError(new Error('suspendtab: Failed to load TabState'));
		return false;
	}
	if (!TabStateFlusher || !TabStateFlusher.flush && !TabState.flush) {
		Cu.reportError(new Error('suspendtab: Missing both TabStateFlusher.flush() and TabState.flush()'));
		return false;
	}
	if (!TabState.clone) {
		Cu.reportError(new Error('suspendtab: TabState does not have clone() method'));
		return false;
	}

	if (!TabStateCache) {
		Cu.reportError(new Error('suspendtab: Failed to load TabStateCache'));
		return false;
	}
	if (!TabStateCache.update) {
		Cu.reportError(new Error('suspendtab: TabStateCache does not have update() method'));
		return false;
	}

	return true;
}

var fullStates = new WeakMap();

function SuspendTabInternal(aWindow)
{
	this.init(aWindow);
}
SuspendTabInternal.prototype = inherit(require('const'), {
	MESSAGE_TYPE: 'suspendtab@piro.sakura.ne.jp',
	SCRIPT_URL: 'chrome://suspendtab/content/content-utils.js',

	destroyed : false,

	get debug()
	{
		return prefs.getPref(this.domain + 'debug');
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

	init : function(aWindow)
	{
		SuspendTabInternal.instances.push(this);
		this.window = aWindow;

		this.handleMessage = this.handleMessage.bind(this);
		this.window.messageManager.addMessageListener(this.MESSAGE_TYPE, this.handleMessage);
		this.window.messageManager.loadFrameScript(this.SCRIPT_URL, true);
	},

	destroy : function(aIsGoingToBeDisabled)
	{
		this.destroyed = true;

		this.window.messageManager.broadcastAsyncMessage(this.MESSAGE_TYPE, {
			command : 'shutdown'
		});
		this.window.messageManager.removeDelayedFrameScript(this.SCRIPT_URL);
		this.window.messageManager.removeMessageListener(this.MESSAGE_TYPE, this.handleMessage);
		this.handleMessage = undefined;

		delete this.window;

		if (SuspendTabInternal)
			SuspendTabInternal.instances.splice(SuspendTabInternal.instances.indexOf(this), 1);
	},

	isSuspended : function(aTab)
	{
		var browser = aTab.linkedBrowser;
		return browser && browser.__SS_restoreState == TAB_STATE_NEEDS_RESTORE;
	},

	isSuspending : function(aTab)
	{
		return aTab[this.SUSPENDING];
	},

	isSuspendable : function(aTab)
	{
		var browser = aTab.linkedBrowser;
		return (
			browser &&
			browser.__SS_restoreState != TAB_STATE_NEEDS_RESTORE &&
			(
				!SessionStoreInternal._windowBusyStates ||
				!SessionStoreInternal._windowBusyStates.get(browser.ownerDocument.defaultView)
			)
		);
	},

	suspend : function(aTab, aOptions)
	{
		return new Promise((function(aResolve, aReject) {
		var browser = aTab.linkedBrowser;
		if (browser.__SS_restoreState == TAB_STATE_RESTORING ||
			browser.__SS_restoreState == TAB_STATE_WILL_RESTORE) {
			var onRestored = (function() {
				aTab.removeEventListener('SSTabRestored', onRestored, false);
				this.suspend(aTab, aOptions)
					.then(aResolve);
			}).bind(this);
			aTab.addEventListener('SSTabRestored', onRestored, false);
			return;
		}

		aOptions = aOptions || {};
		if (this.isSuspended(aTab))
			return aResolve(true);

		{
			let event = this.document.createEvent('Events');
			event.initEvent(this.EVENT_TYPE_SUSPENDING, true, true);
			if (!aTab.dispatchEvent(event))
				return aResolve(false);
		}

		if (this.debug)
			dump(' suspend '+aTab._tPos+'\n');

		aTab[this.SUSPENDING] = true;

		if (TabStateFlusher) {
			return TabStateFlusher.flush(browser)
				.then((function() {
					return this.suspendPostProcess(aTab, aOptions);
				}).bind(this))
				.then(aResolve);
		}
		else {
			TabState.flush(browser);
			this.suspendPostProcess(aTab, aOptions);
			return aResolve(true);
		}
		}).bind(this));
	},
	suspendPostProcess : function(aTab, aOptions)
	{
		if (
			!aTab.parentNode || // already removed tab
			!TabState // service already destroyed
			)
			return;

		var label   = aTab.label;
		var browser = aTab.linkedBrowser;
		var wasBusy = aTab.getAttribute('busy') == 'true';

		var state = TabState.clone(aTab);
		fullStates.set(aTab, state);

		var uri = browser.currentURI.clone();
		if (uri.spec == 'about:blank' && state.userTypedValue)
			uri = Services.io.newURI(state.userTypedValue, null, null);

		if (wasBusy)
			label = aOptions.label = uri.spec;

		// We only need minimum data required to restore the session history,
		// so drop needless information.
		var partialState = {
			entries   : state.entries,
			storage   : state.storage || null,
			index     : state.index,
			pageStyle : state.pageStyle || null
		};
		SS.setTabValue(aTab, this.STATE, JSON.stringify(partialState));
		SS.setTabValue(aTab, this.OPTIONS, JSON.stringify(aOptions));

		aTab.linkedBrowser.messageManager.sendAsyncMessage(this.MESSAGE_TYPE, {
			command : 'suspend',
			params  : {
				uri   : uri.spec,
				label : label,
				icon  : state.attributes.image || state.image,
				debug : prefs.getPref(this.domain + 'debug.content')
			}
		});
	},
	completeSuspend : function(aTab, aParams)
	{
		aParams = aParams || {};

		var label = aParams.label || '';
		var icon = aParams.icon || '';

		aTab.setAttribute('label', label);
		aTab.setAttribute('visibleLabel', label);
		if (this.debug)
			aTab.setAttribute('tooltiptext', label +' (suspended)');

		// Because Firefox sets the default favicon on this event loop,
		// we have to reset the favicon in the next loop.
		setTimeout((function() {
			if (!aTab.parentNode)
				return;
			if (this.debug)
				dump(' => set icon '+icon+'\n');
			this.browser.setIcon(aTab, icon, aTab.linkedBrowser.contentPrincipal);
		}).bind(this), 0);

		aTab.setAttribute('pending', true);
		aTab.setAttribute(this.SUSPENDED, true);

		this.readyToResume(aTab);

		delete aTab[this.SUSPENDING];

		{
			let event = this.document.createEvent('Events');
			event.initEvent(this.EVENT_TYPE_SUSPENDED, true, false);
			aTab.dispatchEvent(event);
		}
	},

	handleMessage : function(aMessage)
	{
/*
		if (this.debug) {
			dump('*********************handleMessage*******************\n');
			dump('TARGET IS: '+aMessage.target.localName+'\n');
			dump(JSON.stringify(aMessage.json)+'\n');
		}
*/

		var tab;
		try {
			tab = this.browser.getTabForBrowser(aMessage.target);
		}
		catch(e) {
			dump(e + '\n');
		}

		if (!tab) {
			dump(' => message from non-tab target\n');
			return;
		}

		switch (aMessage.json.command)
		{
			case 'initialized':
				dump(' => tab '+tab._tPos+' initialized\n');
				return;

			case 'suspended':
				this.completeSuspend(tab, aMessage.json.params);
				return;

			case 'loaded':
				if (tab.getAttribute('pending') != 'true')
					tab.removeAttribute(this.SUSPENDED);
				if (!tab.selected && tab.__suspendtab__suspendAfterLoad) {
					setTimeout((function() {
						if (!tab.parentNode)
							return;
						delete tab.__suspendtab__suspendAfterLoad;
						if (tab.selected)
							return;
						this.suspend(tab);
					}).bind(this), 500);
				}
				let event = this.document.createEvent('Events');
				event.initEvent(this.EVENT_TYPE_TAB_LOADED, true, false);
				tab.dispatchEvent(event);
				return;
		}
	},

	resume : function(aTabs)
	{
		if (aTabs instanceof this.window.Element)
			aTabs = [aTabs];

		return Promise.all(aTabs.map(function(aTab) {
			return this.resumeOne(aTab);
		}, this));
	},

	resumeOne : function(aTab, aIdMap, aDocIdentMap)
	{
		if (this.isSuspending(aTab)) {
			return new Promise((function(aResolve, aReject) {
				var onSuspended = (function(aEvent) {
					aTab.removeEventListener(aEvent.type, onSuspended, false);
					this.resumeOne(aTab, aIdMap, aDocIdentMap)
						.then(aResolve);
				}).bind(this);
				aTab.addEventListener(this.EVENT_TYPE_SUSPENDED, onSuspended, false);
			}).bind(this));
		}

		if (!this.isSuspended(aTab))
			return Promise.resolve(true);

		if (!aTab.selected) {
			// Reloading action resumes the pending restoration.
			// This will fire "SSTabRestored" event, then this method
			// will be called again to restore actual history entries.
			aTab.linkedBrowser.reload();
			return Promise.resolve(true);
		}

		{
			let event = this.document.createEvent('Events');
			event.initEvent(this.EVENT_TYPE_RESUMING, true, true);
			if (!aTab.dispatchEvent(event))
				return Promise.resolve(false);
		}

		var state = this.getTabState(aTab, true);
		var options = this.getTabOptions(aTab, true);
		if (!state)
			return Promise.resolve(true);

		fullStates.delete(aTab);

		SessionStoreInternal.restoreTabContent(aTab);

		var event = this.document.createEvent('Events');
		event.initEvent(this.EVENT_TYPE_RESUMED, true, false);
		aTab.dispatchEvent(event);

		if (this.debug)
			aTab.setAttribute('tooltiptext', aTab.label);

		return Promise.resolve(true);
	},

	resumeAll : function(aRestoreOnlySuspendedByMe)
	{
		return Promise.all([...this.tabs].map(function(aTab) {
			if (!aRestoreOnlySuspendedByMe ||
				aTab.getAttribute(this.SUSPENDED) == 'true')
				return this.resumeOne(aTab);
		}, this));
	},

	getTabState : function(aTab, aClear)
	{
		var state = SS.getTabValue(aTab, this.STATE);
		if (!state)
			return null;

		if (aClear)
			SS.setTabValue(aTab, this.STATE, '');

		return fullStates.get(aTab) || JSON.parse(state);
	},

	getTabOptions : function(aTab, aClear)
	{
		var options = SS.getTabValue(aTab, this.OPTIONS);
		if (!options)
			return {};

		if (aClear)
			SS.setTabValue(aTab, this.OPTIONS, '');

		return JSON.parse(options);
	},

	// This restores history entries, but they don't eat the RAM
	// because Firefox doesn't build DOM tree until they are actually loaded.
	readyToResume : function(aTab)
	{
		var state = this.getTabState(aTab);
		if (!state)
			return;

		var browser = aTab.linkedBrowser;
		var tabbrowser = this.browser;


		// ==BEGIN==
		// these codes are imported from SessionStoreInternal.restoreTabs()

		// Ensure the index is in bounds.
		let activeIndex = (state.index || state.entries.length) - 1;
		activeIndex = Math.min(activeIndex, state.entries.length - 1);
		activeIndex = Math.max(activeIndex, 0);

		// Save the index in case we updated it above.
		state.index = activeIndex + 1;

		// In electrolysis, we may need to change the browser's remote
		// attribute so that it runs in a content process.
		let activePageData = state.entries[activeIndex] || null;
		let uri = activePageData ? activePageData.url || null : null;
		tabbrowser.updateBrowserRemotenessByURL(browser, uri);

		// Start a new epoch and include the epoch in the restoreHistory
		// message. If a message is received that relates to a previous epoch, we
		// discard it.
		let epoch;
		if (typeof SessionStoreInternal.startNextEpoch == 'function') {
			epoch = SessionStoreInternal.startNextEpoch(browser);
		} else {
			epoch = SessionStoreInternal._nextRestoreEpoch++;
			SessionStoreInternal._browserEpochs.set(browser.permanentKey, epoch);
		}

		// keep the data around to prevent dataloss in case
		// a tab gets closed before it's been properly restored
		browser.__SS_data = state;
		browser.__SS_restoreState = TAB_STATE_NEEDS_RESTORE;
		browser.setAttribute('pending', 'true');
		aTab.setAttribute('pending', 'true');

		// Update the persistent tab state cache with |state| information.
		TabStateCache.update(browser, {
			history: {entries: state.entries, index: state.index},
			scroll: state.scroll || null,
			storage: state.storage || null,
			formdata: state.formdata || null,
			disallow: state.disallow || null,
			pageStyle: state.pageStyle || null,
			// This information is only needed until the tab has finished restoring.
			// When that's done it will be removed from the cache and we always
			// collect it in TabState._collectBaseTabData().
			image: state.image || '',
			userTypedValue: state.userTypedValue || '',
			userTypedClear: state.userTypedClear || 0
		});

		browser.messageManager.sendAsyncMessage('SessionStore:restoreHistory',
		                                        {tabData: state, epoch: epoch});

		TabRestoreQueue.add(aTab);
		// ==END==
	}
});
SuspendTabInternal.isAvailable = isInternalAPIsAvailable;

SuspendTabInternal.instances = [];

SuspendTabInternal.resumeAll = function(aRestoreOnlySuspendedByMe) {
	return Promise.all(this.instances.map(function(aInstance) {
		return aInstance.resumeAll(aRestoreOnlySuspendedByMe);
	}));
};

function shutdown(aReason)
{
	if (aReason == 'ADDON_DISABLE')
		return SuspendTabInternal.resumeAll(true)
				.then(shutdownPostProcess);
	else
		return shutdownPostProcess();
}
function shutdownPostProcess(aReason)
{
	return Promise.all(SuspendTabInternal.instances.map(function(aInstance) {
		return aInstance.destroy(aReason == 'ADDON_DISABLE');
	}))
	.then(function() {
	SuspendTabInternal.instances = [];
	setTimeout = clearTimeout = undefined;

	SS = undefined;
	SessionStoreInternal = undefined;
	// TabRestoreStates = undefined;
	TabState = undefined;
	TabStateCache = undefined;
	TabStateFlusher = undefined;

	fullStates = undefined;

	SuspendTabInternal = undefined;

	shutdown = undefined;
	});
}
