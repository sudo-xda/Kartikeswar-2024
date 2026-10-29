package in.kartikeswar.app;

import android.Manifest;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.telephony.SmsManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * Sends an SMS straight from the phone's own SIM (no SMS app, no tapping).
 * Resolves once every part of the message has been handed to the network.
 */
@CapacitorPlugin(
    name = "KpSms",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }) }
)
public class KpSmsPlugin extends Plugin {

    @PluginMethod
    public void send(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        sendNow(call);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            sendNow(call);
        } else {
            call.reject("SMS permission denied", "PERMISSION_DENIED");
        }
    }

    private void sendNow(PluginCall call) {
        String phone = call.getString("phone");
        String message = call.getString("message");
        if (phone == null || phone.isEmpty() || message == null || message.isEmpty()) {
            call.reject("Phone and message are required", "BAD_INPUT");
            return;
        }
        try {
            Context context = getContext();
            SmsManager sms = Build.VERSION.SDK_INT >= 31
                ? context.getSystemService(SmsManager.class)
                : SmsManager.getDefault();
            ArrayList<String> parts = sms.divideMessage(message);
            String action = context.getPackageName() + ".SMS_SENT." + System.nanoTime();
            int[] waiting = { parts.size() };
            boolean[] failed = { false };

            BroadcastReceiver receiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context c, Intent intent) {
                    if (getResultCode() != Activity.RESULT_OK) failed[0] = true;
                    waiting[0]--;
                    if (waiting[0] > 0) return;
                    try {
                        c.unregisterReceiver(this);
                    } catch (Exception ignored) {
                    }
                    if (failed[0]) {
                        call.reject("SMS not sent", "SEND_FAILED");
                    } else {
                        JSObject result = new JSObject();
                        result.put("parts", parts.size());
                        call.resolve(result);
                    }
                }
            };
            IntentFilter filter = new IntentFilter(action);
            if (Build.VERSION.SDK_INT >= 33) {
                context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                context.registerReceiver(receiver, filter);
            }

            ArrayList<PendingIntent> sentIntents = new ArrayList<>();
            for (int i = 0; i < parts.size(); i++) {
                Intent sent = new Intent(action).setPackage(context.getPackageName());
                sentIntents.add(PendingIntent.getBroadcast(context, i, sent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT));
            }
            sms.sendMultipartTextMessage(phone, null, parts, sentIntents, null);
        } catch (Exception e) {
            call.reject("SMS not sent: " + e.getMessage(), "SEND_FAILED");
        }
    }
}
