# TACTO para Android

Esta envoltura carga la aplicación web local desde los assets del APK y entrega sus patrones breves al vibrador nativo de Android. Incluye la versión española e inglesa con sus 96 narraciones (48 por idioma) y funciona sin conexión. Abre en el idioma del teléfono; el selector **ES · EN** de la cabecera lo cambia y la elección se recuerda. Incluye selectores del sistema para importar imágenes o archivos `.tacto.json` y guardar recorridos o proyectos.

## Requisitos de compilación

- Windows, PowerShell y Node.js.
- La primera compilación descarga y verifica la toolchain portable en `artifacts/android-toolchain/` (Temurin JDK 21, Android Platform 35 y Build Tools 35).
- No requiere Gradle ni paquetes Android adicionales.

Desde la raíz del repositorio:

```powershell
.\android-app\build.ps1
```

En Windows PowerShell 5.1, si se invoca desde otra consola o herramienta, es más seguro lanzarlo como proceso aparte y sin redirigir la salida de error (`2>&1`): las advertencias de `javac` se convertirían en errores y detendrían la compilación.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\android-app\build.ps1
```

`aapt2` en Windows guarda los assets anidados con barra invertida (`assets/assets\app.js`) y Android no los encontraría. El script renombra esas entradas con barra normal antes de alinear y firmar, y al final falla si queda alguna o falta un archivo clave. Este fallo afectaba también al APK compilado el 10 de noviembre de 2026, que no llegó a probarse en el teléfono.

El APK queda en `artifacts/TACTO-Android.apk`. La compilación incluye el `dist/` actual; vuelve a ejecutar el script tras cambiar la aplicación web. Se firma con una clave de desarrollo local excluida de Git, por lo que Android puede impedir actualizar una instalación firmada con otra clave. No es una clave de publicación. Las descargas de JDK/SDK se comprueban con hashes fijos antes de extraerse.

## Decisiones y permisos

- La vista usa `https://appassets.androidplatform.net/assets/` como origen local confiable y sirve recursos del APK mediante `WebViewClient`. Las peticiones fuera de ese host se bloquean.
- No declara `INTERNET`. El único permiso Android es `VIBRATE`.
- `window.TactoNative.vibrate` recibe un patrón JSON; limita cada tramo a 60 ms, hasta siete tramos y 180 ms de vibración acumulada. Una llamada sin pulso cancela el motor. La respuesta `true` significa que se aceptó o encoló la orden; la percepción se confirma por separado.
- Para Android 13+ se asigna el uso `USAGE_TOUCH`; versiones anteriores usan asistencia de sonificación. La respuesta respeta las preferencias del sistema.
- El selector `ACTION_OPEN_DOCUMENT` limita el acceso a archivos que la persona elige. `ACTION_CREATE_DOCUMENT` escribe las exportaciones en la ubicación que elija.
- Las voces de los ejemplos son WAV incluidos. La app no usa cuentas, telemetría ni servicios remotos.

## Prueba pendiente

Instalar el APK en el Xiaomi 14T, comprobar que la página carga (no debe aparecer «Not Found»), activar «Respuesta háptica», probar «Probar vibración» y recorrer zonas. Cambiar a **EN**, pulsar «Test voice» y recorrer la célula para oír la narración inglesa. El APK diagnóstico anterior comprobó físicamente pulsos nativos 1 y 2 en ese teléfono; eso aún no valida el WebView completo, las importaciones/guardado con proveedores concretos, TalkBack, ni todos los fabricantes.
