package __PACKAGE__;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;

import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;

import org.junit.Test;
import org.junit.runner.RunWith;

// The background-audio gate: proves the foreground service keeps running after the app is
// backgrounded (real home-press). This validates the custom keep-alive mechanism; the audio
// element itself + MediaSession are covered by the web unit/e2e tests. True physical screen-lock
// across OEMs is accepted as best-effort and not asserted here.
@RunWith(AndroidJUnit4.class)
public class ForegroundServiceTest {

    private boolean notificationPresent(NotificationManager nm) {
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            if (sbn.getId() == PlaybackService.NOTIFICATION_ID) {
                return true;
            }
        }
        return false;
    }

    @Test
    public void serviceSurvivesBackgrounding() throws Exception {
        Context ctx = ApplicationProvider.getApplicationContext();
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);

        Intent intent = new Intent(ctx, PlaybackService.class);
        intent.putExtra(PlaybackService.EXTRA_TITLE, "Test Track");
        ctx.startForegroundService(intent);

        long deadline = System.currentTimeMillis() + 5000;
        while (!notificationPresent(nm) && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
        }
        assertTrue("foreground notification should be posted", notificationPresent(nm));

        UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
        device.pressHome();
        Thread.sleep(2000);
        assertTrue("service should survive backgrounding", notificationPresent(nm));

        ctx.stopService(intent);
        Thread.sleep(1000);
        assertFalse("notification should clear after stop", notificationPresent(nm));
    }
}
