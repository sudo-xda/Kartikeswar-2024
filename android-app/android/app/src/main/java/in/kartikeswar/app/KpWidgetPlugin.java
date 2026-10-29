package in.kartikeswar.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Receives the latest numbers from the app and redraws the home-screen widget. */
@CapacitorPlugin(name = "KpWidget")
public class KpWidgetPlugin extends Plugin {

    private static final String[] KEYS = {
        "title", "today", "total", "pending", "labelToday", "labelTotal", "labelPending", "updated"
    };

    @PluginMethod
    public void update(PluginCall call) {
        SharedPreferences.Editor editor =
            getContext().getSharedPreferences(SummaryWidget.PREFS, Context.MODE_PRIVATE).edit();
        for (String key : KEYS) {
            String value = call.getString(key);
            if (value != null) editor.putString(key, value);
        }
        editor.apply();
        SummaryWidget.refreshAll(getContext());
        call.resolve();
    }
}
