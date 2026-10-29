#!/usr/bin/env bash
# Builds the signed release APK on this PC using the toolchain already in openGymv1/.toolchain
# (JDK 21, Android SDK 36, Gradle 8.14.3) — nothing is downloaded. Run from Git Bash:
#   bash android-app/build-local.sh            → android-app/Kartikeswar.apk
# Override the toolchain location with TOOLCHAIN=/path/to/.toolchain if it moves.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TC="${TOOLCHAIN:-$HERE/../../openGymv1/.toolchain}"
TC_WIN="$(cygpath -w "$TC" 2>/dev/null || echo "$TC")"
export JAVA_HOME="$TC_WIN\jdk21"
export ANDROID_HOME="$TC_WIN\android-sdk" ANDROID_SDK_ROOT="$TC_WIN\android-sdk"
export GRADLE_USER_HOME="$TC_WIN\gradle"
export PATH="$TC/jdk21/bin:$PATH"

cd "$HERE"
npx cap sync android
cd android
printf "sdk.dir=%s\n" "$(cygpath -m "$TC/android-sdk" 2>/dev/null || echo "$TC/android-sdk")" > local.properties
"$TC/gradle-8.14.3/bin/gradle" --no-daemon assembleRelease
cp app/build/outputs/apk/release/app-release.apk "$HERE/Kartikeswar.apk"
echo "APK: $HERE/Kartikeswar.apk"
