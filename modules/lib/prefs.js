/*
 Preferences Library

 Usage:
   var value = window['piro.sakura.ne.jp'].prefs.getPref('my.extension.pref');
   window['piro.sakura.ne.jp'].prefs.setPref('my.extension.pref', true);
   window['piro.sakura.ne.jp'].prefs.clearPref('my.extension.pref');
   var listener = {
         domains : [
           'browser.tabs',
           'extensions.someextension'
         ],
         observe : function(aSubject, aTopic, aData)
         {
           if (aTopic != 'nsPref:changed') return;
           var value = window['piro.sakura.ne.jp'].prefs.getPref(aData);
         }
       };
   window['piro.sakura.ne.jp'].prefs.addPrefListener(listener);
   window['piro.sakura.ne.jp'].prefs.removePrefListener(listener);

   // utility
   var store = window['piro.sakura.ne.jp'].prefs.createStore('extensions.someextension.');
   // property name/key, default value
   store.define('enabled', true);
   // property name, default value, pref key (different to the name)
   store.define('leftMargin', true, 'margin.left');
   var enabled = store.enabled;
   store.destroy(); // free the memory.

 license: The MIT License, Copyright (c) 2009-2017 YUKI "Piro" Hiroshi
 original:
   http://github.com/piroor/fxaddonlib-prefs
*/

/* To work as a JS Code Module  */
if (typeof window == 'undefined' ||
	(window && typeof window.constructor == 'function')) {
	this.EXPORTED_SYMBOLS = ['prefs'];

	// If namespace.jsm is available, export symbols to the shared namespace.
	// See: http://github.com/piroor/fxaddonlibs/blob/master/namespace.jsm
	try {
		let ns = {};
		Components.utils.import('resource://my-modules/namespace.jsm', ns);
		/* var */ window = ns.getNamespaceFor('piro.sakura.ne.jp');
	}
	catch(e) {
		window = {};
	}
}

(function() {
	const currentRevision = 17;

	if (!('piro.sakura.ne.jp' in window)) window['piro.sakura.ne.jp'] = {};

	var loadedRevision = 'prefs' in window['piro.sakura.ne.jp'] ?
			window['piro.sakura.ne.jp'].prefs.revision :
			0 ;
	if (loadedRevision && loadedRevision > currentRevision) {
		return;
	}

	const Cc = Components.classes;
	const Ci = Components.interfaces;

	window['piro.sakura.ne.jp'].prefs = {
		revision : currentRevision,

		Prefs : Cc['@mozilla.org/preferences;1']
					.getService(Ci.nsIPrefBranch),

		DefaultPrefs : Cc['@mozilla.org/preferences-service;1']
					.getService(Ci.nsIPrefService)
					.getDefaultBranch(null),
	 
		getPref : function(aPrefstring, aInterface, aBranch) 
		{
			if (!aInterface || aInterface instanceof Ci.nsIPrefBranch)
				[aBranch, aInterface] = [aInterface, aBranch];

			aBranch = aBranch || this.Prefs;

			var type = aBranch.getPrefType(aPrefstring);
			if (type == aBranch.PREF_INVALID)
				return null;

			if (aInterface)
				return aBranch.getComplexValue(aPrefstring, aInterface);

			try {
				switch (type)
				{
					case aBranch.PREF_STRING:
						return decodeURIComponent(escape(aBranch.getCharPref(aPrefstring)));

					case aBranch.PREF_INT:
						return aBranch.getIntPref(aPrefstring);

					case aBranch.PREF_BOOL:
						return aBranch.getBoolPref(aPrefstring);

					case aBranch.PREF_INVALID:
					default:
						return null;
				}
			} catch(e) {
				// getXXXPref can raise an error if it is the default branch.
				return null;
			}
		},

		getLocalizedPref : function(aPrefstring)
		{
			try {
				return this.getPref(aPrefstring, Ci.nsIPrefLocalizedString).data;
			} catch(e) {
				return this.getPref(aPrefstring);
			}
		},

		getDefaultPref : function(aPrefstring, aInterface)
		{
			return this.getPref(aPrefstring, this.DefaultPrefs, aInterface);
		},
	 
		setPref : function(aPrefstring, aNewValue) 
		{
			var branch = this.Prefs;
			var interface = null;
			if (arguments.length > 2) {
				for (let i = 2; i < arguments.length; i++)
				{
					let arg = arguments[i];
					if (!arg)
						continue;
					if (arg instanceof Ci.nsIPrefBranch)
						branch = arg;
					else
						interface = arg;
				}
			}
			if (interface &&
				aNewValue instanceof Ci.nsISupports) {
				return branch.setComplexValue(aPrefstring, interface, aNewValue);
			}
			switch (typeof aNewValue)
			{
				case 'string':
					return branch.setCharPref(aPrefstring, unescape(encodeURIComponent(aNewValue)));

				case 'number':
					return branch.setIntPref(aPrefstring, parseInt(aNewValue));

				default:
					return branch.setBoolPref(aPrefstring, !!aNewValue);
			}
		},

		setDefaultPref : function(aPrefstring, aNewValue)
		{
			return this.setPref(aPrefstring, aNewValue, this.DefaultPrefs);
		},
	 
		clearPref : function(aPrefstring) 
		{
			if (this.Prefs.prefHasUserValue(aPrefstring))
				this.Prefs.clearUserPref(aPrefstring);
		},
	 
		getDescendant : function(aRoot, aBranch) 
		{
			aBranch = aBranch || this.Prefs;
			return aBranch.getChildList(aRoot, {}).sort();
		},
	 
		getChildren : function(aRoot, aBranch) 
		{
			aRoot = aRoot.replace(/\.$/, '');
			var foundChildren = {};
			var possibleChildren = [];
			this.getDescendant(aRoot, aBranch)
					.forEach(function(aPrefstring) {
						var name = aPrefstring.replace(aRoot + '.', '');
							let possibleChildKey = aRoot + '.' + name.split('.')[0];
							if (possibleChildKey && !(possibleChildKey in foundChildren)) {
								possibleChildren.push(possibleChildKey);
								foundChildren[possibleChildKey] = true;
							}
					});
			return possibleChildren.sort();
		},
	 
		addPrefListener : function(aObserver) 
		{
			var domains = ('domains' in aObserver) ? aObserver.domains : [aObserver.domain] ;
			try {
				for (var domain of domains)
					this.Prefs.addObserver(domain, aObserver, false);
			}
			catch(e) {
			}
		},
	 
		removePrefListener : function(aObserver) 
		{
			var domains = ('domains' in aObserver) ? aObserver.domains : [aObserver.domain] ;
			try {
				for (var domain of domains)
					this.Prefs.removeObserver(domain, aObserver, false);
			}
			catch(e) {
			}
		},

		createStore : function(aDomain)
		{
			var listener = {
				domain : aDomain,
				observe : function(aSubject, aTopic, aData) {
					if (aTopic != 'nsPref:changed')
						return;
					var name = keyToName[aData];
					store[name] = window['piro.sakura.ne.jp'].prefs.getPref(aData);
				}
			};
			this.addPrefListener(listener);
			var keyToName = {};
			var base = aDomain.replace(/\.$/, '') + '.';
			var store = {
				define : function(aName, aValue, aKey) {
					aKey = base + (aKey || aName);
					window['piro.sakura.ne.jp'].prefs.setDefaultPref(aKey, aValue);
					this[aName] = window['piro.sakura.ne.jp'].prefs.getPref(aKey);
					keyToName[aKey] = aName;
				},
				destroy : function() {
					window['piro.sakura.ne.jp'].prefs.removePrefListener(listener);
					aDomain = undefined;
					base = undefined;
					listener = undefined;
					keyToName = undefined;
					store = undefined;
				}
			};
			return store;
		}
	};
})();

if (window != this) { // work as a JS Code Module
	this.prefs = window['piro.sakura.ne.jp'].prefs;
}
