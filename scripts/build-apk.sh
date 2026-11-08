#!/bin/sh
# Builds the debug APK without Android Studio. Uses the JDK, Android SDK and Gradle in ~/Android when
# they are there (JAVA_HOME / ANDROID_HOME from the environment win), otherwise the Gradle wrapper.
set -e
cd "$(dirname "$0")/.."

: "${JAVA_HOME:=$HOME/Android/jdk-21/Contents/Home}"
: "${ANDROID_HOME:=$HOME/Android/sdk}"
export JAVA_HOME ANDROID_HOME

npm run android:sync

cd android
if [ -x "$HOME/Android/gradle-8.14.3/bin/gradle" ]; then
  "$HOME/Android/gradle-8.14.3/bin/gradle" assembleDebug
else
  ./gradlew assembleDebug
fi

echo "APK:"
ls -1 app/build/outputs/apk/debug/*.apk | sed 's|^|  android/|'
