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

load('lib/WindowManager');

var timer = require('lib/jstimer');

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

var SuspendTabConst = require('const');

var exports = {
	isSuspended : function(aTab)
	{
		return SS.getTabValue(aTab, SuspendTabConst.STATE);
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
		SS.setTabValue(aTab, SuspendTabConst.STATE, JSON.stringify(partialState));

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

		var state = SS.getTabValue(aTab, SuspendTabConst.STATE);
		if (!state) return;
		state = JSON.parse(state);
		SS.setTabValue(aTab, SuspendTabConst.STATE, '');

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
	timer = undefined;
	SS = undefined;
	internalSS = undefined;

	shutdown = undefined;
}
