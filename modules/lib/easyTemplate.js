/**
 * @fileOverview Easy template module for restartless addons
 * @author       YUKI "Piro" Hiroshi
 * @version      3
 *
 * @license
 *   The MIT License, Copyright (c) 2012 YUKI "Piro" Hiroshi.
 *   https://github.com/piroor/restartless/blob/master/license.txt
 * @url http://github.com/piroor/restartless
 */

if (typeof window == 'undefined' ||
	(window && typeof window.constructor == 'function')) {
	this.EXPORTED_SYMBOLS = ['easyTemplate'];

	/** A handler for bootstrap.js */
	function shutdown() {
		easyTemplate = undefined;
	}
}

var easyTemplate = {
	apply : function() {
		if (arguments.length)
			return this._applyToString.apply(this, arguments);
		else
			return this._applyToDocument();
	},

	_systemPrincipal : Components.classes['@mozilla.org/systemprincipal;1']
						.createInstance(Components.interfaces.nsIPrincipal),
	_documentPrincipal : (function() {
		return (typeof window != 'undefined' && window && typeof window.constructor != 'function') ?
				document.nodePrincipal : null;
	})(),

	_applyToString : function(aString, aNamespace) {
		var sandbox = new Components.utils.Sandbox(
				this._documentPrincipal || this._systemPrincipal,
				{ sandboxPrototype: aNamespace }
			);
		return aString.split('}}')
				.map(function(aPart) {
					let [string, code] = aPart.split('{{');
					return string + (code && Components.utils.evalInSandbox(code, sandbox) || '');
				})
				.join('');
	},

	_applyToDocument : function() {
		var sandbox = new Components.utils.Sandbox(
				this._documentPrincipal,
				{ sandboxPrototype: window }
			);

		Array.forEach(document.querySelectorAll('stringbundle'), function(aBundle) {
			if (aBundle.id)
				sandbox[aBundle.id] = aBundle;
		});

		['title', 'label', 'value'].forEach(function(aAttribute) {
			var selector = '*[' + aAttribute + '^="{{"][' + aAttribute + '$="}}"]';
			var anonymousRoot = document.getAnonymousNodes(document.documentElement)[0];
			Array.slice(document.querySelectorAll(selector))
				.concat(Array.slice(anonymousRoot.querySelectorAll(selector)))
				.forEach(function(aNode) {
					var definition = aNode.getAttribute(aAttribute);
					definition = definition.replace(/^\{\{|\}\}$/g, '');
					var label = Components.utils.evalInSandbox(definition, sandbox);
					aNode.setAttribute(aAttribute, label);
				});
		});

		var textNodes = document.evaluate(
				'descendant::text()[starts-with(self::text(), "{{")]',
				document,
				null,
				Components.interfaces.nsIDOMXPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
				null
			);
		for (var i = textNodes.snapshotLength-1; i > -1; i--) {
			let node = textNodes.snapshotItem(i);
			let definition = node.nodeValue;
			if (/\}\}$/.test(definition)) { // because "ends-with()" is not available yet
				definition = definition.replace(/^\{\{|\}\}$/g, '');
				node.nodeValue = Components.utils.evalInSandbox(definition, sandbox);
			}
		}
	}
};
