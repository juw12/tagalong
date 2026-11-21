; Tagalong for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Tagalong> /DOutputDir=<dist> /DIconFile=<build\tagalong.ico> tagalong.iss
; Installs to %LOCALAPPDATA%\Programs\Tagalong, adds Tagalong to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (your trips, votes and bills) in %LOCALAPPDATA%\Tagalong, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Tagalong"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\tagalong.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Tagalong
AppVersion={#AppVersion}
AppVerName=Tagalong {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/tagalong/
AppSupportURL=https://github.com/juw12/tagalong
DefaultDirName={autopf}\Tagalong
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Tagalong-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Tagalong.exe
UninstallDisplayName=Tagalong
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Tagalong"; Filename: "{app}\Tagalong.exe"; Comment: "A group trip planner"
Name: "{userdesktop}\Tagalong"; Filename: "{app}\Tagalong.exe"; Comment: "A group trip planner"; Tasks: desktopicon

[Run]
Filename: "{app}\Tagalong.exe"; Description: "{cm:LaunchProgram,Tagalong}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Tagalong.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopTagalong"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Tagalong window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Tagalong.exe')) then
    Exec(ExpandConstant('{app}\Tagalong.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
