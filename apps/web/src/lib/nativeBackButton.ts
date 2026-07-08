import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Android hardware/gesture back button: navigate the in-app router history
 * first, and only let the OS close the app once there's nowhere left to go
 * back to. Without this, Android's default behaviour exits the app straight
 * from the editor, silently discarding whatever the user was mid-drawing.
 */
export function installAndroidBackButtonHandler(): void {
  if (Capacitor.getPlatform() !== 'android') return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      void App.exitApp();
    }
  });
}
