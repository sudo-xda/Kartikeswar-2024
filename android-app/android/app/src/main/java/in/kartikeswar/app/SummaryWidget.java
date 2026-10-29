package in.kartikeswar.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/** Home-screen widget: today's collection, total collected and donors yet to pay. */
public class SummaryWidget extends AppWidgetProvider {

    static final String PREFS = "kp_widget";

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SummaryWidget.class));
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static RemoteViews build(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_summary);
        views.setTextViewText(R.id.widget_title, prefs.getString("title", "Kartikeswar Puja"));
        views.setTextViewText(R.id.widget_today, prefs.getString("today", "–"));
        views.setTextViewText(R.id.widget_total, prefs.getString("total", "–"));
        views.setTextViewText(R.id.widget_pending, prefs.getString("pending", "–"));
        views.setTextViewText(R.id.widget_label_today, prefs.getString("labelToday", "Today"));
        views.setTextViewText(R.id.widget_label_total, prefs.getString("labelTotal", "Total"));
        views.setTextViewText(R.id.widget_label_pending, prefs.getString("labelPending", "Yet to pay"));
        views.setTextViewText(R.id.widget_updated, prefs.getString("updated", "Open the app to load"));

        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
        return views;
    }
}
