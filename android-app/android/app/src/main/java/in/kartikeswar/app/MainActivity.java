package in.kartikeswar.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-specific native features used by the web app (see app/app.js)
        registerPlugin(KpSmsPlugin.class);
        registerPlugin(KpWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
