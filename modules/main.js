load('lib/WindowManager');
load('lib/ToolbarItem');

var timer = require('lib/jstimer');

var bundle = require('lib/locale')
				.get(resolve('locale/label.properties'));

var suspend = require('suspend');

function handleCommand(aEvent)
{
	var tab = aEvent.target.ownerDocument.defaultView.gBrowser.selectedTab;
	if (suspend.isSuspended(tab))
		suspend.resume(tab);
	else
		suspend.suspend(tab);
}

function init(aWindow)
{
	var toolbar = aWindow.document.getElementById('nav-bar');
	aWindow.suspendResumeButton = ToolbarItem.create(
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
	aWindow.suspendResumeButton.addEventListener('command', handleCommand, false);
}

function uninit(aWindow)
{
	aWindow.suspendResumeButton.removeEventListener('command', handleCommand, false);
	aWindow.suspendResumeButton.destroy();
	delete aWindow.suspendResumeButton;
}

const TYPE_BROWSER = 'navigator:browser';

function handleWindow(aWindow, aInitialization)
{
	aWindow.addEventListener('load', function() {
		aWindow.removeEventListener('load', arguments.callee, false);
		if (aWindow.document.documentElement.getAttribute('windowtype') == TYPE_BROWSER)
			init(aWindow);
	}, false);
}

WindowManager.getWindows(TYPE_BROWSER).forEach(init);
WindowManager.addHandler(handleWindow);

function shutdown()
{
	WindowManager.getWindows(TYPE_BROWSER).forEach(function(aWindow) {
		uninit(aWindow);
	});
	WindowManager = undefined;
	ToolbarItem = undefined;
	bundle = undefined;
}
