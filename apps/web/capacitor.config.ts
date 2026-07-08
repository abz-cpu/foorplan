import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uk.co.ldenergy.floorplanstudio',
  appName: 'Floor Plan Studio',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      backgroundColor: '#F4F7F6',
      showSpinner: false,
      launchAutoHide: true,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#F4F7F6',
    },
  },
};

export default config;
