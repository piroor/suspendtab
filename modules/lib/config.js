/**
 * @fileOverview Configuration dialog module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      12
 *
 * @license
 *   The MIT License, Copyright (c) 2011-2012 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

const EXPORTED_SYMBOLS = ['config'];

const XULNS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

'open,register,unregister,setDefault'.split(',').forEach(function(aSymbol) {
	exports[aSymbol] = function() {
		if (!config)
			throw new Error('config module was already unloaded!');
		return config[aSymbol].apply(config, arguments);
	};
});

/**
 * @class
 *   Provides features to manage custom configuration dialog.
 */
var config = {
	_configs : {},

	/**
	 * Opens a registered dialog bound to the given URI as a "non-modal"
	 * window. If there is existing window, then focus to it.
	 *
	 * @param {String} aURI
	 *   A URI which is bould to any configuration dialog.
	 * @param {nsIDOMWindow} aOwner
	 *   An owner window of the dialog.
	 *
	 * @returns {nsIDOMWindow}
	 *   The window object of the configuration dialog.
	 */
	open : function(aURI, aOwner)
	{
		aURI = this._resolveResURI(aURI);
		if (!(aURI in this._configs))
			return null;

		var current = this._configs[aURI];

		if (current.openedWindow && !current.openedWindow.closed) {
			current.openedWindow.focus();
			return current.openedWindow;
		}

		var source = Cc['@mozilla.org/variant;1']
						.createInstance(Ci.nsIWritableVariant);
		source.setFromVariant([this._builder.toSource(), current.source, aURI, current.script, this]);

		if (aOwner) {
			let parent = aOwner.top
							.QueryInterface(Ci.nsIInterfaceRequestor)
							.getInterface(Ci.nsIWebNavigation)
							.QueryInterface(Ci.nsIDocShell)
							.QueryInterface(Ci.nsIDocShellTreeNode)
							.QueryInterface(Ci.nsIDocShellTreeItem)
							.parent;
			if (parent)
				aOwner = parent.QueryInterface(Ci.nsIWebNavigation)
							.document
							.defaultView;
			else
				aOwner = null;
		}

		var features = 'chrome,titlebar,toolbar,centerscreen' +
						(Prefs.getBoolPref('browser.preferences.instantApply') ?
							',dialog=no' :
						aOwner ?
							',modal' :
							''
						);
		var window = Cc['@mozilla.org/embedcomp/window-watcher;1']
							.getService(Ci.nsIWindowWatcher)
							.openWindow(
								aOwner || null,
								'data:application/vnd.mozilla.xul+xml,'+encodeURIComponent(
									current.container
								),
								'_blank',
								features,
								source
							);
		if (features.indexOf('modal') < 0)
			return window;
	},

	/**
	 * Registers a source code of a XUL document for a configuration dialog
	 * to the given URI. It is used by open().
	 *
	 * @param {String} aURI
	 *   A URI which is the target URI. When the URI is loaded in a browser
	 *   window, then this system automatically opens a generated XUL window
	 *   from the source.
	 * @param {Object} aSource
	 *   A source of a XUL document for a configuration dialog defined as a
	 *   or something. Typical headers (<?xml version="1.0"?> and
	 *   an <?xml-stylesheet?> for the default theme) are automatically added.
	 *   Note: Any <script/> elements are ignored or doesn't work as you expected.
	 *   You have to put any script as the third argument.
	 * @param {String} aScript
	 *   JavaScript codes to be run in the configuration dialog.
	 */
	register : function(aURI, aSource, aScript)
	{
		if (typeof aScript == 'function')
			aScript = aScript.toSource().replace(/^\(?function\s*\(\)\s*\{|\}\)?$/g, '');

		var header = '<?xml version="1.0"?>\n'+
					'<!-- ' + aURI + ' -->\n'+
					'<?xml-stylesheet href="chrome://global/skin/"?>\n';

		var container;
		var source;
		if (aSource.toXMLString) { // E4X
			let root = aSource.copy();
			delete root['*'];
			let attributes = root.attributes();
			for each (let attribute in attributes)
			{
				delete root['@'+attribute.name()];
			}
			root = root.toXMLString()
					.replace(
						/<([^ ]+)([^>]+)\/>\s*$/,
						'<$1$2><script type="application/javascript">' + this._loader + '</script></$1>'
					);

			let originalSettings = XML.settings();
			XML.ignoreWhitespace = true;
			XML.prettyPrinting = false;

			container = header+((new XMLList(root)).toXMLString());
			source = (new XMLList(aSource.toXMLString())).toXMLString();

			XML.setSettings(originalSettings);
		}
		else { // string
			source = String(aSource);
			let root = source
						.replace(/^\s+|\s+$/g, '')
						.replace(/[\r\n]+/g, ' ')
						.replace(/>.+<\/[^>]+/, '/');
			let xmlnses = root.match(/xmlns(:[^=]+)\s*=\s*('[^']*'|"[^"]*")/g);
			root = root
					.replace(/\s+[^ =]+\s*=\s*('[^']*'|"[^"]*")/g, '')
					.replace(/(\/>)$/, ' ' + Array.slice(xmlnses).join(' ') + '$1')
		}

		this._configs[this._resolveResURI(aURI)] = {
			container    : container,
			source       : source,
			script       : aScript || '',
			openedWindow : null
		};
	},
	_loader : 'eval(arguments[0][0]+"();"+arguments[0][3]);',
	_builder : function()
	{
		var args = window.arguments[0];
		window.config = args[4];
		var soruce = args[1];
		var sourceURI = args[2];
		var root = document.documentElement;
		var range = document.createRange();
		range.selectNode(root);
		var fragment = range.createContextualFragment(soruce);
		// clear white-space nodes from XUL tree
		(function(aNode) {
			Array.slice(aNode.childNodes).forEach(arguments.callee);
			if (aNode.parentNode &&
				aNode.parentNode.namespaceURI == XULNS &&
				aNode.nodeType == Ci.nsIDOMNode.TEXT_NODE &&
				aNode.nodeValue.replace(/^\s+|\s+$/g, '') == '')
				aNode.parentNode.removeChild(aNode);
		})(fragment);
		document.replaceChild(fragment, root);
		range.detach();
		window._sourceURI = sourceURI;
	},

	/**
	 * Unregisters a registeed dialog for the given URI.
	 *
	 * @param {String} aURI
	 *   A URI which have a registered dialog.
	 */
	unregister : function(aURI)
	{
		delete this._configs[this._resolveResURI(aURI)];
	},

	/**
	 * Unregisters a default value for the preference.
	 *
	 * @param {String} aKey
	 *   A key of preference.
	 * @param {nsIVariant} aValue
	 *   The default value. This must be a string, integer, or boolean.
	 */
	setDefault : function(aKey, aValue)
	{
		switch (typeof aValue)
		{
			case 'string':
				return DefaultPrefs.setCharPref(aKey, unescape(encodeURIComponent(aValue)));

			case 'number':
				return DefaultPrefs.setIntPref(aKey, parseInt(aValue));

			default:
				return DefaultPrefs.setBoolPref(aKey, !!aValue);
		}
	},

	observe : function(aSubject, aTopic, aData)
	{
		var uri = aSubject.location.href;
		if (
			uri == 'about:addons' ||
			uri == 'chrome://mozapps/content/extensions/extensions.xul' // Firefox 3.6
			) {
			this._onLoadManager(aSubject);
			return;
		}

		uri = this._resolveResURI(uri);
		if (uri in this._configs) {
			aSubject.setTimeout('window.close();', 0);
			this.open(uri);
		}
	},

	_resolveResURI : function(aURI)
	{
		if (aURI.indexOf('resource:') == 0)
			return ResProtocolHandler.resolveURI(IOService.newURI(aURI, null, null));
		return aURI;
	},

	handleEvent : function(aEvent)
	{
		switch (aEvent.type)
		{
			case 'unload':
				this._onUnloadManager(aEvent.currentTarget);
				return;

			case 'command':
				let target = aEvent.originalTarget;
				let uri;
				if (target.getAttribute('anonid') == 'preferences-btn' ||
					target.id == 'cmd_showItemPreferences')
					uri = target.ownerDocument.defaultView
							.gViewController
							.currentViewObj
							.getSelectedAddon()
							.optionsURL;
				else if (target.id == 'cmd_options') // Firefox 3.6
					uri = target.ownerDocument.defaultView
							.gExtensionsView
							.currentItem
							.getAttribute('optionsURL');
				if (uri &&
					(uri = this._resolveResURI(uri)) &&
					uri in this._configs) {
					this.open(uri, target.ownerDocument.defaultView);
					aEvent.stopPropagation();
					aEvent.preventDefault();
				}
				return;
		}
	},
	_onLoadManager : function(aWindow)
	{
		aWindow.addEventListener('command', this, true);
		aWindow.addEventListener('unload', this, true);
		this._managers.push(aWindow);
	},
	_onUnloadManager : function(aWindow)
	{
		aWindow.removeEventListener('command', this, true);
		aWindow.removeEventListener('unload', this, true);
		this._managers.splice(this._managers.indexOf(aWindow), 1);
	},
	_managers : []
};

var Prefs = Cc['@mozilla.org/preferences;1']
						.getService(Ci.nsIPrefBranch);
var DefaultPrefs = Cc['@mozilla.org/preferences-service;1']
						.getService(Ci.nsIPrefService)
						.getDefaultBranch(null);

var IOService = Cc['@mozilla.org/network/io-service;1']
						.getService(Ci.nsIIOService);
var ResProtocolHandler = IOService
						.getProtocolHandler('resource')
						.QueryInterface(Ci.nsIResProtocolHandler);

var ObserverService = Cc['@mozilla.org/observer-service;1']
						.getService(Ci.nsIObserverService);
ObserverService.addObserver(config, 'chrome-document-global-created', false);
ObserverService.addObserver(config, 'content-document-global-created', false);

var WindowMediator = Cc['@mozilla.org/appshell/window-mediator;1']
						.getService(Ci.nsIWindowMediator)
let (managers = WindowMediator.getEnumerator('Addons:Manager')) {
	while (managers.hasMoreElements())
	{
		config._onLoadManager(managers.getNext().QueryInterface(Ci.nsIDOMWindow));
	}
}
let (browsers = WindowMediator.getEnumerator('navigator:browser')) {
	while (browsers.hasMoreElements())
	{
		let browser = browsers.getNext().QueryInterface(Ci.nsIDOMWindow);
		if (browser.gBrowser)
			Array.slice(browser.gBrowser.mTabContainer.childNodes)
				.forEach(function(aTab) {
				if (aTab.linkedBrowser.currentURI.spec == 'about:addons')
					config._onLoadManager(aTab.linkedBrowser.contentWindow);
			});
	}
}
let (managers = WindowMediator.getEnumerator('Extension:Manager')) { // Firefox 3.6
	while (managers.hasMoreElements())
	{
		config._onLoadManager(managers.getNext().QueryInterface(Ci.nsIDOMWindow));
	}
}

function shutdown()
{
	var windows = WindowMediator.getEnumerator(null);
	while (windows.hasMoreElements())
	{
		let window = windows.getNext().QueryInterface(Ci.nsIDOMWindow);
		if (window._sourceURI && window._sourceURI in config._configs)
			window.close();
	}

	config._managers.forEach(config._onUnloadManager, config);

	ObserverService.removeObserver(config, 'chrome-document-global-created');
	ObserverService.removeObserver(config, 'content-document-global-created');

	Prefs = void(0);
	DefaultPrefs = void(0);
	IOService = void(0);
	ResProtocolHandler = void(0);
	ObserverService = void(0);
	WindowMediator = void(0);

	config._configs = void(0);
	config._managers = void(0);
	config = void(0);
}
