package __PACKAGE__;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

// Ongoing foreground service that keeps WebView audio alive while the app is backgrounded.
// Started/stopped from JS via ForegroundServicePlugin. The media controls + metadata themselves
// come from the WebView MediaSession; this only prevents the OS from killing playback.
public class PlaybackService extends Service {
    public static final String CHANNEL_ID = "dmp_playback";
    public static final int NOTIFICATION_ID = 1;
    public static final String EXTRA_TITLE = "title";

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        if (title == null) {
            title = "Playing";
        }
        createChannel();

        Notification notification = new Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("DMP")
            .setContentText(title)
            .setSmallIcon(getApplicationInfo().icon)
            .setOngoing(true)
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Playback", NotificationManager.IMPORTANCE_LOW);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
}
