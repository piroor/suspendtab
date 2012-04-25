load('lib/WindowManager');
load('lib/ToolbarItem');
load('lib/base64');

var bundle = require('lib/locale')
				.get(resolve('locale/label.properties'));

var timers = [];

function setTimeout(aCallback, aTimeout)
{
	let timer = Cc['@mozilla.org/timer;1']
					.createInstance(Ci.nsITimer);
	timer.initWithCallback(aCallback, aTimeout, timer.TYPE_ONE_SHOT);
	timers.push(timer);
	return timer;
}

function clearTimeout(aTimer)
{
	timers.splice(timers.indexOf(aTimer), 1);
	timer.cancel();
}


var SS = Cc['@mozilla.org/browser/sessionstore;1']
           .getService(Ci.nsISessionStore);

var internalSS = (function() {;
  var ns = {
        atob : function(aInput) { return base64.decode(aInput); },
        btoa : function(aInput) { return base64.encode(aInput); }
      };
  Cc['@mozilla.org/moz/jssubscript-loader;1']
    .getService(Ci.mozIJSSubScriptLoader)
    .loadSubScript('resource://gre/components/nsSessionStore.js', ns);

  return new ns.SessionStoreService();
})();

function isUnloaded(aTab)
{
  return aTab.linkedBrowser.currentURI.spec == 'about:blank?unloaded';
}

function unloadTab(aTab)
{
  if (isUnloaded(aTab))
    return;

  var label = aTab.label;
  var state = SS.getTabState(aTab);
  state = JSON.parse(state);
  var partialState = {
    entries : state.entries,
    storate : state.storage || null,
    index   : state.index
  };
  SS.setTabValue(aTab, 'unloadedState', JSON.stringify(partialState));

  var browser = aTab.linkedBrowser;
  browser.addEventListener('load', function() {
    browser.removeEventListener('load', arguments.callee, true);
    aTab.setAttribute('label', label);
    setTimeout(function() { aTab.setAttribute('image', state.attributes.image); }, 0);
    if (SHistory.count > 0) SHistory.PurgeHistory(SHistory.count);
  }, true);
  browser.loadURI('about:blank?unloaded');
  var SHistory = browser.sessionHistory;
}

function restoreTabs(aTabs)
{
  var idMap = { used : {} };
  var docIdentMap = {};
  aTabs.forEach(function(aTab) {
    restoreTab(aTab, idMap, docIdentMap);
  });
}

function restoreTab(aTab, aIdMap, aDocIdentMap)
{
  if (!isUnloaded(aTab)) return;

  var state = SS.getTabValue(aTab, 'unloadedState');
  if (!state) return;
  state = JSON.parse(state);
  SS.setTabValue(aTab, 'unloadedState', '');

  var browser = aTab.linkedBrowser;
  var SHistory = browser.sessionHistory.QueryInterface(Ci.nsISHistory)
                                       .QueryInterface(Ci.nsISHistoryInternal);
  if (SHistory.count > 0) SHistory.PurgeHistory(SHistory.count);

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



function init(aWindow)
{
	var toolbar = aWindow.document.getElementById('nav-bar');
	aWindow.suspendResumeButton = ToolbarItem.create(
		<>
			<toolbarbutton id="suspend-resume-button"
				tooltiptext={bundle.getString('button.label')}
				oncommand="if (isUnloaded(gBrowser.selectedTab)) restoreTab(gBrowser.selectedTab); else unloadTab(gBrowser.selectedTab);">
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
	aWindow.unloadTab = unloadTab;
	aWindow.restoreTab = restoreTab;
	aWindow.isUnloaded = isUnloaded;
}

function uninit(aWindow)
{
	aWindow.suspendResumeButton.destroy();
	delete aWindow.suspendResumeButton;
	delete aWindow.unloadTab;
	delete aWindow.restoreTab;
	delete aWindow.isUnloaded;
	delete aWindow.internalSS;
}

const TYPE_BROWSER = 'navigator:browser';

function handleWindow(aWindow, aInitialization)
{
	aWindow.addEventListener('load', function() {
		aWindow.removeEventListener('load', arguments.callee, false);
		init(aWindow);
	}, false);
}

WindowManager.getWindows(TYPE_BROWSER).forEach(init);
WindowManager.addHandler(handleWindow);

function shutdown()
{
	WindowManager.getWindows(TYPE_BROWSER).forEach(function(aWindow) {
		var doc = aWindow.document;
		if (doc.documentElement.getAttribute('windowtype') == TYPE_BROWSER) {
			uninit(aWindow);
		}
	});
	WindowManager = undefined;
	ToolbarItem = undefined;
	base64 = undefined;
	bundle = undefined;
	SS = undefined;
	internalSS = undefined;
}
