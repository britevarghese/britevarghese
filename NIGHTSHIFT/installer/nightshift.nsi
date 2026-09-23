; NIGHTSHIFT Server - Windows installer (NSIS 3 + MUI2)
;
; Built by tools/build-installer.sh (Linux) or tools/build-installer.bat (Windows).
; Expects a staged copy of the distributable files, passed in with:
;   makensis -DSTAGE=<stage dir> -DOUTFILE=<output exe> -DVERSION=1.0.0 installer/nightshift.nsi
; The stage dir must contain: server.js, server\, config.json, package.json,
; public\, src\, start.bat, README.md (optional), runtime\node.exe

Unicode true
SetCompressor /SOLID lzma

!ifndef STAGE
  !define STAGE "..\dist\stage"
!endif
!ifndef OUTFILE
  !define OUTFILE "..\dist\NIGHTSHIFT_SERVER_SETUP.exe"
!endif
!ifndef VERSION
  !define VERSION "1.0.0"
!endif

!define APPNAME "NIGHTSHIFT Server"
!define COMPANY "NIGHTSHIFT"
!define PORT "3000"
!define FWRULE "NIGHTSHIFT Server"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NIGHTSHIFTServer"
!define SHORTCUT "Start Nightshift Server"

Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show
BrandingText "${APPNAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "LegalCopyright" "${COMPANY}"

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "This will install ${APPNAME} ${VERSION} on your computer.$\r$\n$\r$\nThe server hosts the NIGHTSHIFT browser racing game for everyone on your LAN or Radmin VPN network. Node.js is included, nothing else needs to be installed.$\r$\n$\r$\nA Windows Firewall rule allowing TCP port ${PORT} will be added.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\start.bat"
!define MUI_FINISHPAGE_RUN_TEXT "Start Nightshift Server now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "${APPNAME} requires 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
FunctionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "NIGHTSHIFT Server" SecMain
  SectionIn RO
  SetShellVarContext all

  SetOutPath "$INSTDIR"
  File "${STAGE}\server.js"
  File "${STAGE}\package.json"
  File "${STAGE}\start.bat"
  File /nonfatal "${STAGE}\README.md"
  ; Keep an existing config.json on upgrade.
  SetOverwrite off
  File "${STAGE}\config.json"
  SetOverwrite on

  SetOutPath "$INSTDIR\server"
  File /r "${STAGE}\server\*.*"
  SetOutPath "$INSTDIR\public"
  File /r "${STAGE}\public\*.*"
  SetOutPath "$INSTDIR\src"
  File /r "${STAGE}\src\*.*"
  SetOutPath "$INSTDIR\docs"
  File /nonfatal /r "${STAGE}\docs\*.*"
  SetOutPath "$INSTDIR\runtime"
  File "${STAGE}\runtime\node.exe"

  ; Shortcuts (working directory = install dir, taken from SetOutPath)
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${SHORTCUT}.lnk" "$INSTDIR\start.bat" "" "$INSTDIR\runtime\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Open Install Folder.lnk" "$INSTDIR"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${SHORTCUT}.lnk" "$INSTDIR\start.bat" "" "$INSTDIR\runtime\node.exe" 0

  ; Firewall: allow inbound TCP on the game port (remove old copy first).
  DetailPrint "Adding Windows Firewall rule for TCP port ${PORT}..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FWRULE}"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="${FWRULE}" dir=in action=allow protocol=TCP localport=${PORT}'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Warning: could not add firewall rule (code $0). Other PCs may not be able to connect."
  ${EndIf}

  ; Uninstaller + Add/Remove Programs entry
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\runtime\node.exe"
  WriteRegStr HKLM "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTKEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext all

  DetailPrint "Removing Windows Firewall rule..."
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="${FWRULE}"'

  Delete "$DESKTOP\${SHORTCUT}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\${SHORTCUT}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Open Install Folder.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"

  ; Only remove what we installed (never RMDir /r $INSTDIR blindly).
  RMDir /r "$INSTDIR\server"
  RMDir /r "$INSTDIR\public"
  RMDir /r "$INSTDIR\src"
  RMDir /r "$INSTDIR\docs"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\server.js"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\start.bat"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\config.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "${UNINSTKEY}"
SectionEnd
