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

var { SessionStoreInternal } = Cu.import('resource:///modules/sessionstore/SessionStore.jsm', {});
//var { TAB_STATE_NEEDS_RESTORE } = Cu.import('resource:///modules/sessionstore/SessionStore.jsm', {});
//it can't be exported because it is defined by ES6 const.
var TAB_STATE_NEEDS_RESTORE = 1;
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

	get debug()
	{
		return prefs.getPref(this.domain + 'debug');
	},

	get saferSuspend()
	{
		return prefs.getPref(this.domain + 'saferSuspend');
	},

	get document()
	{
		return this.window.document;
	},

	init : function(aWindow)
	{
		SuspendTabInternal.instances.push(this);
		this.window = aWindow;
	},

	destroy : function(aWindow)
	{
		delete this.window;
		if (SuspendTabInternal)
			SuspendTabInternal.instances.splice(SuspendTabInternal.instances.indexOf(this), 1);
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
//		// Firefox 25 and later. See: https://bugzilla.mozilla.org/show_bug.cgi?id=867142
//		if (TabRestoreStates &&
//			TabRestoreStates.has(browser))
//			return TabRestoreStates.isNeedsRestore(browser);

		return browser.__SS_restoreState == 1;
	},

	suspend : function(aTab, aOptions)
	{
		aOptions = aOptions || {};
		if (this.isSuspended(aTab))
			return true;

		{
			let event = this.document.createEvent('Events');
			event.initEvent(this.EVENT_TYPE_SUSPENDING, true, true);
			if (!aTab.dispatchEvent(event))
				return false;
		}

		if (this.debug)
			dump(' suspend '+aTab._tPos+'\n');

		var label   = aTab.label;
		var browser = aTab.linkedBrowser;
		var wasBusy = aTab.getAttribute('busy') == 'true';

		if (TabStateFlusher) {
			TabStateFlusher.flush(browser);
		}
		else {
			TabState.flush(browser);
		}
		var state = TabState.clone(aTab);
		fullStates.set(aTab, state);

		var uri = browser.currentURI.clone();
		if (uri.spec == 'about:blank' && state.userTypedValue)
			uri = Services.io.newURI(state.userTypedValue, null, null);

		if (wasBusy)
			aOptions.label = uri.spec;

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

		var SHistory = browser.sessionHistory;

		var self = this;
		browser.addEventListener('load', function onLoad() {
			browser.removeEventListener('load', onLoad, true);

			if (wasBusy)
				label = uri.spec;

			aTab.setAttribute('label', label);
			aTab.setAttribute('visibleLabel', label);
			if (self.debug)
				aTab.setAttribute('tooltiptext', label +' (suspended)');

			// Because Firefox sets the default favicon on this event loop,
			// we have to reset the favicon in the next loop.
			timer.setTimeout(function() {
				aTab.setAttribute('image', state.attributes.image || state.image);
			}, 0);

			browser.docShell.setCurrentURI(uri);
			browser.contentDocument.title = label;

			// Don't purge all histories - leave the last one!
			// The SS module stores the title of the history entry
			// as the title of the restored tab.
			// If there is no history entry, Firefox will restore
			// the tab with the default title (the URI of the page).
			if (SHistory.count > 1)
				SHistory.PurgeHistory(SHistory.count - 1);

			aTab.setAttribute('pending', true);
			aTab.setAttribute(self.SUSPENDED, true);

			if (self.saferSuspend) {
				if (self.debug)
					dump(' => ready to restore '+aTab._tPos+'\n');
				self.readyToResume(aTab);
			}

			{
				let event = self.document.createEvent('Events');
				event.initEvent(self.EVENT_TYPE_SUSPENDED, true, false);
				aTab.dispatchEvent(event);
			}
		}, true);

		// Load a blank page to clear out the current history entries.
		browser.loadURI('about:blank');

		return true;
	},

	resume : function(aTabs)
	{
		if (aTabs instanceof this.window.Element)
			aTabs = [aTabs];

		aTabs.forEach(function(aTab) {
			this.resumeOne(aTab);
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

		{
			let event = this.document.createEvent('Events');
			event.initEvent(this.EVENT_TYPE_RESUMING, true, true);
			if (!aTab.dispatchEvent(event))
				return false;
		}

		var state = this.getTabState(aTab, true);
		var options = this.getTabOptions(aTab, true);
		if (!state)
			return true;

		delete aTab[this.READY];
		fullStates.delete(aTab);

		this.readyToResume(aTab);
		SessionStoreInternal.restoreTabContent(aTab);

		var event = this.document.createEvent('Events');
		event.initEvent(this.EVENT_TYPE_RESUMED, true, false);
		aTab.dispatchEvent(event);

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
		if (!this.isSuspended(aTab) ||
			aTab[this.READY])
			return true;

		if (this.isSuspendedBySS(aTab))
			return true;

		var state = this.getTabState(aTab);
		if (!state)
			return true;

		var browser = aTab.linkedBrowser;
		var tabbrowser = this.window.gBrowser;


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
		if (typeof tabbrowser.updateBrowserRemotenessByURL == 'function') // Firefox 33 and later
			tabbrowser.updateBrowserRemotenessByURL(browser, uri);
		else // Firefox 32 or older
			tabbrowser.updateBrowserRemoteness(browser, uri);

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
		browser.setAttribute("pending", "true");
		aTab.setAttribute("pending", "true");

		// Update the persistent tab state cache with |state| information.
		TabStateCache.update(browser, {
		  history: {entries: state.entries, index: state.index},
		  scroll: state.scroll || null,
		  storage: state.storage || null,
		  formdata: state.formdata || null,
		  disallow: state.disallow || null,
		  pageStyle: state.pageStyle || null
		});

		browser.messageManager.sendAsyncMessage("SessionStore:restoreHistory",
		                                        {tabData: state, epoch: epoch});
		// ==END==


		aTab[this.READY] = true;

		return true;
	},

	resumeAll : function(aRestoreOnlySuspendedByMe)
	{
		Array.forEach(this.tabs, function(aTab) {
			this.cancelTimer(aTab);
			if (!aRestoreOnlySuspendedByMe ||
				aTab.getAttribute(this.SUSPENDED) == 'true')
				this.resume(aTab);
		}, this);
	}
});
SuspendTabInternal.isAvailable = isInternalAPIsAvailable;

SuspendTabInternal.instances = [];

function shutdown(aReason)
{
	SuspendTabInternal.instances.forEach(function(aInstance) {
		if (aReason == 'ADDON_DISABLE')
			aInstance.resumeAll(true);
		aInstance.destroy();
	});

	timer = undefined;

	SS = undefined;
	SessionStoreInternal = undefined;
	// TabRestoreStates = undefined;
	TabState = undefined;
	TabStateCache = undefined;
	TabStateFlusher = undefined;

	fullStates = undefined;

	SuspendTabInternal = undefined;

	shutdown = undefined;
}
