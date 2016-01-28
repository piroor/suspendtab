(function(global) {
	var Cc = Components.classes;
	var Ci = Components.interfaces;
	var Cu = Components.utils;
	var Cr = Components.results;

	var { Services } = Cu.import('resource://gre/modules/Services.jsm', {});

	var MESSAGE_TYPE = 'suspendtab@piro.sakura.ne.jp';

	function free()
	{
		free =
			Cc = Ci = Cu = Cr =
			Services =
			MESSAGE_TYPE =
			suspend =
			handleMessage =
				undefined;
	}

	function suspend(aParams)
	{
		aParams = aParams || {};

		var webNavigation = docShell.QueryInterface(Ci.nsIWebNavigation);
		var SHistory = webNavigation.sessionHistory;

		global.addEventListener('load', function onLoad() {
			global.removeEventListener('load', onLoad, true);

			var uri = Services.io.newURI(aParams.uri || 'about:blank', null, null);
			docShell.setCurrentURI(uri);
			content.document.title = aParams.label || '';

			// Don't purge all histories - leave the last one!
			// The SS module stores the title of the history entry
			// as the title of the restored tab.
			// If there is no history entry, Firefox will restore
			// the tab with the default title (the URI of the page).
			if (SHistory.count > 1)
				SHistory.PurgeHistory(SHistory.count - 1);

			if (aParams.debug)
				content.alert('PURGED');

			global.sendAsyncMessage(MESSAGE_TYPE, {
				command : 'suspended',
				params  : aParams
			});
		}, true);

		if (aParams.debug)
			content.alert('MAKE BLANK');

		// Load a blank page to clear out the current history entries.
		content.location.href = 'about:blank';
	}

	function handleMessage(aMessage)
	{
		switch (aMessage.json.command)
		{
			case 'suspend':
				if (aMessage.json.params.debug)
					content.alert('SUSPEND');
				suspend(aMessage.json.params);
				return;

			case 'shutdown':
				global.removeMessageListener(MESSAGE_TYPE, handleMessage);
				free();
				return;
		}
	}
	global.addMessageListener(MESSAGE_TYPE, handleMessage);

	global.sendAsyncMessage(MESSAGE_TYPE, {
		command : 'initialized'
	});
})(this);
