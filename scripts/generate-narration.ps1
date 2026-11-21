<#
  Generate the bundled lesson narration using installed Windows voices.
  Run from Windows PowerShell 5.1:
    powershell.exe -NoProfile -File scripts/generate-narration.ps1
    powershell.exe -NoProfile -File scripts/generate-narration.ps1 -Languages en
  First run node scripts/prepare-narration.mjs after changing lesson text.
  Spanish uses an es-ES voice (Helena Desktop preferred); English uses an en-US
  voice (Zira Desktop preferred). Each asset is spoken from its "spoken" text,
  which may respell a name for the voice; the written text stays the lookup key.
  The input JSON is explicitly read as UTF-8 to preserve accents.
  No cloud TTS service, credentials, audio downloads, or extra packages are used.
#>
[CmdletBinding()]
param(
  [ValidateSet('es', 'en')]
  [string[]]$Languages = @('es', 'en'),
  [ValidateSet(16000, 22050)]
  [int]$SampleRate = 22050
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$contentPath = Join-Path $PSScriptRoot 'narration-content.json'
$outputDirectory = [System.IO.Path]::GetFullPath((Join-Path $projectDirectory 'dist\audio'))
if (-not (Test-Path -LiteralPath $contentPath -PathType Leaf)) {
  throw 'Falta narration-content.json. Ejecuta node scripts/prepare-narration.mjs.'
}

$content = Get-Content -LiteralPath $contentPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($content.schema -ne 'tacto.narration.v2') {
  throw 'El formato del contenido de las narraciones no es compatible. Ejecuta node scripts/prepare-narration.mjs.'
}
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

Add-Type -AssemblyName System.Speech
$format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
  $SampleRate,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

$summary = @()
foreach ($language in $Languages) {
  $settings = $content.provenance.voices.$language
  if (-not $settings) { throw "No hay configuracion de voz para '$language'." }
  $culturePrefix = ([string]$settings.culture).Split('-')[0]
  $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $installed = @($synthesizer.GetInstalledVoices() | Where-Object {
      $_.Enabled -and $_.VoiceInfo.Culture.Name.Split('-')[0] -eq $culturePrefix
    })
    $candidates = @(@($settings.voicePreference) + @($installed | ForEach-Object { $_.VoiceInfo.Name })) | Select-Object -Unique
    $selectedVoice = $null
    foreach ($name in $candidates) {
      if (@($installed | Where-Object { $_.VoiceInfo.Name -eq $name }).Count -gt 0) {
        try {
          $synthesizer.SelectVoice($name)
          $selectedVoice = $name
          break
        } catch {
          # Some installed OneCore voices may not be usable by System.Speech.
        }
      }
    }
    if (-not $selectedVoice) {
      throw "No hay una voz '$($settings.culture)' compatible con System.Speech. Instala o habilita una (por ejemplo, $(@($settings.voicePreference)[0]))."
    }

    $synthesizer.Rate = 0
    $synthesizer.Volume = 90
    [long]$totalBytes = 0
    [int]$fileCount = 0
    foreach ($asset in @($content.assets | Where-Object { $_.lang -eq $language })) {
      $fileName = [string]$asset.file
      $spokenText = [string]$asset.spoken
      if ($fileName -notmatch '^[a-z0-9][a-z0-9_-]*\.wav$' -or [string]::IsNullOrWhiteSpace($spokenText)) {
        throw 'Una narracion tiene un nombre de archivo o un texto no valido.'
      }
      $outputPath = [System.IO.Path]::GetFullPath((Join-Path $outputDirectory $fileName))
      $parentDirectory = [System.IO.Path]::GetDirectoryName($outputPath)
      if (-not $parentDirectory.Equals($outputDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'El archivo de salida debe permanecer dentro de dist/audio.'
      }

      try {
        $synthesizer.SetOutputToWaveFile($outputPath, $format)
        $synthesizer.Speak($spokenText)
      } finally {
        # Close the stream and finalize its WAV header before checking the file.
        $synthesizer.SetOutputToNull()
      }
      $size = (Get-Item -LiteralPath $outputPath).Length
      if ($size -le 44) { throw "La narracion $fileName no contiene audio." }
      $totalBytes += $size
      $fileCount += 1
    }

    $summary += [pscustomobject]@{
      Language = $language
      Voice = $selectedVoice
      Files = $fileCount
      SampleRate = $SampleRate
      TotalBytes = $totalBytes
    }
  } finally {
    $synthesizer.Dispose()
  }
}

[pscustomobject]@{
  Output = $outputDirectory
  BitsPerSample = 16
  Channels = 1
  Languages = $summary
} | ConvertTo-Json -Compress -Depth 4
