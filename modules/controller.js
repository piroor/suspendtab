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
 * The Initial Developer of the Original Code is SHIMODA Hiroshi.
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):: SHIMODA Hiroshi <piro.outsider.reflex@gmail.com>
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

var EXPORTED_SYMBOLS = ['SuspendTabController'];

load('lib/WindowManager');
load('lib/ToolbarItem');
load('lib/prefs');
var timer = require('lib/jstimer');

var bundle = require('lib/locale')
				.get(resolve('locale/label.properties'));

var SS = Cc['@mozilla.org/browser/sessionstore;1']
			.getService(Ci.nsISessionStore);

var internalSS = (function() {;
	var ns = {
			atob : function(aInput) { return WindowManager.getWindow('navigator:browser').atob(aInput); },
			btoa : function(aInput) { return WindowManager.getWindow('navigator:browser').btoa(aInput); }
		};
	Cc['@mozilla.org/moz/jssubscript-loader;1']
		.getService(Ci.mozIJSSubScriptLoader)
		.loadSubScript('resource://gre/components/nsSessionStore.js', ns);

	return new ns.SessionStoreService();
})();

function SuspendTabController(aWindow)
{
	this.init(aWindow);
}
SuspendTabController.prototype = {
	__proto__ : require('const'),

	get autoSuspend()
	{
		return prefs.getPref(this.domain + 'autoSuspend.enabled');
	},
	get autoSuspendTimeout()
	{
		return prefs.getPref(this.domain + 'autoSuspend.timeout');
	},
	get resetTimersOnReload()
	{
		return prefs.getPref(this.domain + 'autoSuspend.resetTimersOnReload');
	},

	get tabs()
	{
		return this.window.gBrowser.mTabContainer.childNodes;
	},

	handleEvent : function(aEvent)
	{
		switch (aEvent.type)
		{
			case 'command':
				return this.onCommand(aEvent);

			case 'TabSelect':
				return this.onTabSelect(aEvent);

			case 'SSTabRestored':
				return this.resume(aEvent.originalTarget);

			case 'unload':
				return this.uninit(aEvent.relatedTarget);
		}
	},

	observe : function(aSubject, aTopic, aData)
	{
		if (aTopic != 'nsPref:changed')
			return;

		switch (aData)
		{
			case this.domain + 'autoSuspend.enabled':
			case this.domain + 'autoSuspend.timeout':
				return this.setTimers(true);
		}
	},

	onStateChange : function(aBrowser, aWebProgress, aRequest, aStateFlags, aStatus)
	{
		if (!this.resetTimersOnReload)
			return;

		Array.some(this.tabs, function(aTab) {
			if (aTab.linkedBrowser != aBrowser)
				return false;

			this.reserveSuspend(aTab);
			return true;
		}, this);
	},

	onCommand : function(aEvent)
	{
		var tab = aEvent.target.ownerDocument.defaultView.gBrowser.selectedTab;
		if (this.isSuspended(tab))
			this.resume(tab);
		else
			this.suspend(tab);
	},

	onTabSelect : function(aEvent)
	{
		this.cancelTimer(aEvent.originalTarget);
		this.resume(aEvent.originalTarget);
		this.setTimers();
	},

	setTimers : function(aReset)
	{
		Array.forEach(this.tabs, function(aTab) {
			if (aTab.selected)
				return;

			if (aTab.__suspendtab__timer && !aReset)
				return;

			if (aReset)
				this.cancelTimer(aTab);
			if (this.autoSuspend)
				this.reserveSuspend(aTab);
		}, this);
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
			timer.clearTimeout(aTab.__suspendtab__timer);
			aTab.__suspendtab__timer = null;
		}
	},

	reserveSuspend : function(aTab)
	{
		this.cancelTimer(aTab);

		if (this.isSuspended(aTab))
			return;

		aTab.__suspendtab__timer = timer.setTimeout(function(aSelf) {
			if (aSelf.autoSuspend)
				aSelf.suspend(aTab);
			aTab.__suspendtab__timer = null;
		}, this.autoSuspendTimeout, this)
	},

	init : function(aWindow)
	{
		this.window = aWindow;
		this.window.addEventListener('unload', this, false);
		this.window.addEventListener('TabSelect', this, true);
		this.window.addEventListener('SSTabRestored', this, true);
		this.window.gBrowser.addTabsProgressListener(this);

		this.setTimers();

		var toolbar = this.window.document.getElementById('nav-bar');
		this.toolbarButton = ToolbarItem.create(
			<>
				<toolbarbutton id="suspend-resume-button"
					tooltiptext={bundle.getString('button.label')}>
					<label value={bundle.getString('button.label')}/>
				</toolbarbutton>
			</>,
			toolbar,
			{
				onInit : function() {
				},
				onDestroy : function() {
				}
			}
		);
		this.toolbarButton.addEventListener('command', this, false);
	},

	destroy : function()
	{
		this.cancelTimers();

		this.window.removeEventListener('unload', this, false);
		this.window.removeEventListener('TabSelect', this, true);
		this.window.removeEventListener('SSTabRestored', this, true);
		this.window.gBrowser.removeTabsProgressListener(this);

		this.toolbarButton.removeEventListener('command', this, false);
		this.toolbarButton.destroy();
		delete this.toolbarButton;

		delete this.window;
	},


	isSuspended : function(aTab)
	{
		return SS.getTabValue(aTab, this.STATE);
	},

	suspend : function(aTab)
	{
		if (this.isSuspended(aTab))
			return;

		var label = aTab.label;
		var state = SS.getTabState(aTab);
		state = JSON.parse(state);
		var partialState = {
			entries : state.entries,
			storate : state.storage || null,
			index	 : state.index
		};
		SS.setTabValue(aTab, this.STATE, JSON.stringify(partialState));

		var browser = aTab.linkedBrowser;
		browser.addEventListener('load', function() {
			browser.removeEventListener('load', arguments.callee, true);
			aTab.setAttribute('label', label);
			timer.setTimeout(function() {
				aTab.setAttribute('image', state.attributes.image);
			}, 0);
			if (SHistory.count > 0) SHistory.PurgeHistory(SHistory.count);
		}, true);
		browser.loadURI('about:blank');
		var SHistory = browser.sessionHistory;
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
		if (!this.isSuspended(aTab)) return;

		var state = SS.getTabValue(aTab, this.STATE);
		if (!state) return;
		state = JSON.parse(state);
		SS.setTabValue(aTab, this.STATE, '');

		var browser = aTab.linkedBrowser;
		var SHistory = browser.sessionHistory
							.QueryInterface(Ci.nsISHistory)
							.QueryInterface(Ci.nsISHistoryInternal);
		if (SHistory.count > 0)
			SHistory.PurgeHistory(SHistory.count);

		aIdMap = aIdMap || { used : {} };
		aDocIdentMap = aDocIdentMap || {};

		state.entries.forEach(function(aEntry) {
			SHistory.addEntry(internalSS._deserializeHistoryEntry(aEntry, aIdMap, aDocIdentMap), true);
		});

		if (internalSS._deserializeSessionStorage &&
			state.storage &&
			browser.docShell instanceof Ci.nsIDocShell)
			internalSS._deserializeSessionStorage(state.storage, browser.docShell);

		var index = (state.index || state.entries.length) - 1;
		if (index >= state.entries.length)
			index = state.entries.length - 1;

		if (index > -1) {
			try {
				SHistory.getEntryAtIndex(index, true);
				SHistory.reloadCurrentEntry();
			}
			catch(e) {
				dump(e+'\n');
			}
		}
	}
};

function shutdown()
{
	WindowManager = undefined;
	ToolbarItem = undefined;
	timer = undefined;
	bundle = undefined;

	SS = undefined;
	internalSS = undefined;

	SuspendTabController = undefined;

	shutdown = undefined;
}
