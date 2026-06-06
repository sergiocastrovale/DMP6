package __PACKAGE__;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Exposes window.Capacitor.Plugins.ForegroundService.start({title}) / .stop() to the web bundle.
// See web/composables/useNativeBridge.ts (guarded - no-ops in a plain browser).
@CapacitorPlugin(name = "ForegroundService")
public class ForegroundServicePlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), PlaybackService.class);
        String title = call.getString("title");
        intent.putExtra(PlaybackService.EXTRA_TITLE, title != null ? title : "Playing");
        getContext().startForegroundService(intent);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PlaybackService.class));
        call.resolve();
    }
}
