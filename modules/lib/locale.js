/**
 * @fileOverview Locale module for restartless addons
 * @author       SHIMODA "Piro" Hiroshi
 * @version      4
 *
 * @license
 *   The MIT License, Copyright (c) 2010-2011 SHIMODA "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

const EXPORTED_SYMBOLS = ['locale'];

const DEFAULT_LOCALE = 'en-US';

var gCache = {}
var get = function(aPath, aBaseURI) {
		if (/^\w+:/.test(aPath))
			aBaseURI = aPath;

		var locale = DEFAULT_LOCALE;
		try {
			let prefs = Cc['@mozilla.org/preferences;1'].getService(Ci.nsIPrefBranch);
			locale = prefs.getCharPref('general.useragent.locale');
			if (/\w+:/.test(locale))
				locale = prefs.getComplexValue('general.useragent.locale', Ci.nsIPrefLocalizedString).data;
			locale = locale || DEFAULT_LOCALE;
		}
		catch(e) {
		dump(e+'\n');
		}
		var uri = aPath;
		[
			aPath+'.'+locale,
			aPath+'.'+(locale.split('-')[0]),
			aPath+'.'+DEFAULT_LOCALE,
			aPath+'.'+(DEFAULT_LOCALE.split('-')[0])
		].some(function(aURI) {
			var resolved = exists(aURI, aBaseURI);
			if (resolved) {
				uri = resolved;
				return true;
			}
			return false;
		});

		if (!(uri in gCache)) {
			gCache[uri] = new StringBundle(uri);
		}
		return gCache[uri];
	};
exports.get = get;

var locale = { 'get' : get };

const Service = Cc['@mozilla.org/intl/stringbundle;1']
					.getService(Ci.nsIStringBundleService);

function StringBundle(aURI) 
{
	this._bundle = Service.createBundle(aURI);
}
StringBundle.prototype = {
	getString : function(aKey) {
		try {
			return this._bundle.GetStringFromName(aKey);
		}
		catch(e) {
		}
		return '';
	},
	getFormattedString : function(aKey, aArray) {
		try {
			return this._bundle.formatStringFromName(aKey, aArray, aArray.length);
		}
		catch(e) {
		}
		return '';
	},
	get strings() {
		return this._bundle.getSimpleEnumeration();
	}
};

/** A handler for bootstrap.js */
function shutdown()
{
	gCache = {};
	Service.flushBundles();
}
