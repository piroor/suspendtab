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
 * Portions created by the Initial Developer are Copyright (C) 2012
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):: YUKI "Piro" Hiroshi <piro.outsider.reflex@gmail.com>
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

var config = require('lib/config');
var bundle = require('lib/locale')
				.get(resolve('locale/label.properties'));

var SuspendTabConst = require('const');
var domain = SuspendTabConst.domain;

config.register('about:blank?suspendtab-config', <>

<prefwindow id="suspendtab-config"
	xmlns="http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul"
	title={bundle.getString('title')}>

	<prefpane id="prefpane-general">
<!--
		label={bundle.getString('tab.general')}
-->
		<preferences>
			<preference id="autoSuspend.enabled"
				name={domain+'autoSuspend.enabled'}
				type="bool"/>
			<preference id="autoSuspend.timeout"
				name={domain+'autoSuspend.timeout'}
				type="int"/>
			<preference id="autoSuspend.timeout.factor"
				name={domain+'autoSuspend.timeout.factor'}
				type="int"/>
			<preference id="autoSuspend.resetOnReload"
				name={domain+'autoSuspend.resetOnReload'}
				type="bool"/>
		</preferences>

		<checkbox label={bundle.getString('autoSuspend.enabled')}
			preference="autoSuspend.enabled"/>
		<hbox align="center">
			<spacer style="width:1em;"/>
			<label value={bundle.getString('autoSuspend.timeout.before')}
				control="autoSuspend.timeout-textbox"/>
			<textbox id="autoSuspend.timeout-textbox"
				preference="autoSuspend.timeout"
				type="number"
				size="5"
				min="0"
				increment="1"/>
			<label value={bundle.getString('autoSuspend.timeout.middle')}
				control="autoSuspend.timeout-textbox"/>
			<menulist id="autoSuspend.timeout.factor-menulist"
				preference="autoSuspend.timeout.factor">
				<menupopup>
					<menuitem label={bundle.getString('autoSuspend.timeout.factor.hours')} value="3600000"/>
					<menuitem label={bundle.getString('autoSuspend.timeout.factor.minutes')} value="60000"/>
					<menuitem label={bundle.getString('autoSuspend.timeout.factor.seconds')} value="1000"/>
					<menuitem label={bundle.getString('autoSuspend.timeout.factor.milliseconds')} value="1"/>
				</menupopup>
			</menulist>
			<label value={bundle.getString('autoSuspend.timeout.after')}
				control="autoSuspend.timeout-textbox"/>
		</hbox>
		<hbox align="center">
			<spacer style="width:1em;"/>
			<checkbox label={bundle.getString('autoSuspend.resetOnReload')}
				preference="autoSuspend.resetOnReload"/>
		</hbox>
	</prefpane>
</prefwindow>

</>
);
