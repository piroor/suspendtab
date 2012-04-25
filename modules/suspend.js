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

exports = {
	isSuspended : function(aTab)
	{
		return SS.getTabValue(aTab, 'suspendtab-state');
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
		SS.setTabValue(aTab, 'suspendtab-state', JSON.stringify(partialState));

		var browser = aTab.linkedBrowser;
		browser.addEventListener('load', function() {
			browser.removeEventListener('load', arguments.callee, true);
			aTab.setAttribute('label', label);
			timer.setTimeout(function() {
				aTab.setAttribute('image', state.attributes.image);
			}, 0);
			if (SHistory.count > 0) SHistory.PurgeHistory(SHistory.count);
		}, true);
		browser.loadURI('about:blank?unloaded');
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

		var state = SS.getTabValue(aTab, 'suspendtab-state');
		if (!state) return;
		state = JSON.parse(state);
		SS.setTabValue(aTab, 'suspendtab-state', '');

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
