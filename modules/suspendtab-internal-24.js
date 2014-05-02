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

var EXPORTED_SYMBOLS = ['SuspendTabInternal'];

load('lib/prefs');
load('lib/here');
var timer = require('lib/jstimer');

var SS = Cc['@mozilla.org/browser/sessionstore;1']
			.getService(Ci.nsISessionStore);

var internalSS = (function() {;
	var ns = {
			atob : atob,
			btoa : btoa
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
SuspendTabInternal.isAvailable = isInternalAPIsAvailable;

var fullStates = {};

function SuspendTabInternal(aWindow)
{
	this.init(aWindow);
}
SuspendTabInternal.prototype = {
	__proto__ : require('const'),

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
	{
		var browser = aTab.linkedBrowser;
		return browser.__SS_restoreState == 1;
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
		let stateWithPrivateData = internalSS._collectTabData(aTab, true); // the second argument is ignored on Firefox 25 and later...
		if (internalSS._updateTextAndScrollDataForTab.length == 4) // Firefox 24 and olders
			internalSS._updateTextAndScrollDataForTab(this.window, aTab.linkedBrowser, stateWithPrivateData, true);
		fullStates[aTab.getAttribute('linkedpanel')] = JSON.stringify({
			entries   : stateWithPrivateData.entries,
			storage   : stateWithPrivateData.storage || null,
			index     : stateWithPrivateData.index,
			pageStyle : stateWithPrivateData.pageStyle || null
		});

		// OK, let's destroy the current session history!
		var browser = aTab.linkedBrowser;
		var SHistory = browser.sessionHistory;
		var uri = browser.currentURI.clone();
		var self = this;
		browser.addEventListener('load', function() {
			browser.removeEventListener('load', arguments.callee, true);

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
			if (SHistory.count > 1) SHistory.PurgeHistory(SHistory.count - 1);

			if (self.saferSuspend) {
				if (self.debug)
					dump(' => ready to restore '+aTab._tPos+'\n');
				self.readyToResume(aTab);
			}

			aTab.setAttribute('pending', true);
			aTab.setAttribute(self.SUSPENDED, true);

			let (event = self.document.createEvent('Events')) {
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
};
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
	internalSS = undefined;

	fullStates = undefined;

	SuspendTabInternal = undefined;

	shutdown = undefined;
}
