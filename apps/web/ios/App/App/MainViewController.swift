import Capacitor

/// The editor canvas already claims pan/zoom gestures at the DOM level
/// (touchAction: none, custom pinch/pan handling). WKWebView's default
/// edge-swipe back/forward navigation gesture fights those same gestures at
/// the native layer, so it's disabled here rather than left to conflict with
/// drawing on the canvas.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.allowsBackForwardNavigationGestures = false
    }
}
