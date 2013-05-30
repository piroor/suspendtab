# History

 - master/HEAD
 - 0.1.2013053101
   * Modified: Just to pass through AMO Editor's review, make codes free from "evalInSandbox()" and E4X. They were still there only for backward compatibilities so they never caused errors/security issues on lately Firefox, however, editors persecutive rejected those codes, then I've given up and removed them.
 - 0.1.2013052901
   * Modified: Some codes depending on "evalInSandbox()" are just removed. AMO Editors always banned new releases, because an included library had codes with "evalInSandbox()" for backward compatibility - even if it is NEVER called on this addon.
   * Modified: Update codes around [session store API](http://dutherenverseauborddelatable.wordpress.com/2013/05/23/add-on-breakage-continued-list-of-add-ons-that-will-probably-be-affected/).
 - 0.1.2013040601
   * Fixed: Restore suspended tab automatically when it is reloaded.
 - 0.1.2012122901
   * Released.
