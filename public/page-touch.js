/* Allow normal scrolling/selection; suppress Safari's page pinch gesture only.
   No viewport scale cap, touchmove cancellation, wheel or keyboard interception. */
(function () {
  const preventPagePinch = event => { if (event.cancelable) event.preventDefault(); };
  document.addEventListener('gesturestart', preventPagePinch, { passive: false });
  document.addEventListener('gesturechange', preventPagePinch, { passive: false });
})();
