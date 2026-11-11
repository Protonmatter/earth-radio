# Production Settings/account focus correction

Production0.33.0 verification caught a visible-state error: AuthUI always mounts
its closed .er-auth-modal node; existence must not disable Settings containment.
Preview origins disableauth, so local/preview defaultSettings cases missed it.
Use the existing account owner's [hidden] visible-state flag. Preserve priority
for an actually open account dialog, Escape/Close return, all accounts/providers.

Small bounded correction in responsive-ui.js plus auth-enabled browser fixture/
cases; coherent0.33.1/v75 release URLs/runtime fingerprint/worker and provenance.
No new dependency, resource, provider/schema/credential/permission/network.
Risklow-to-medium: modal keyboard behavior and coherent cache identity only.
Validate observed RED from account-enabled mobile+desktop in both engines, then
GREEN sameflags+existing authfocus; fullverify,allbrowser,rendered/native. One fresh
wholebranchreview; exactheadCI+actualpreview and auth-enabled local before merge,
then finalmain/production actual auth-enabled UI and byte/header/route acceptance.
Retain failedproduction evidence; do not call originalTodaydelivery complete yet.
Only newcost requires a question; existing end-to-end publication authority applies.
