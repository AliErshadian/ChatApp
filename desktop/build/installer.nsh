; =============================================================================
; RELAY — Professional NSIS installer customizations (electron-builder)
; Docs: https://www.electron.build/nsis#custom-nsis-script
; =============================================================================

!include "LogicLib.nsh"

!define RELAY_EXE "RELAY.exe"
!define RELAY_PROCESS "RELAY.exe"
!define RELAY_APP_NAME "RELAY"
!define RELAY_TAGLINE "Fast · Secure · Connected"

; -----------------------------------------------------------------------------
; Branding / Modern UI page copy
; -----------------------------------------------------------------------------
!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Welcome to ${RELAY_APP_NAME} Setup"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "Setup will install ${RELAY_APP_NAME} on your computer.$\r$\n$\r$\n${RELAY_TAGLINE}$\r$\n$\r$\nIt is recommended that you close all other applications before continuing.$\r$\n$\r$\nClick Next to continue."

  !define MUI_FINISHPAGE_TITLE "${RELAY_APP_NAME} has been installed"
  !define MUI_FINISHPAGE_TITLE_3LINES
  !define MUI_FINISHPAGE_TEXT "${RELAY_APP_NAME} was installed successfully.$\r$\n$\r$\nYou can launch it from the Start menu or the desktop shortcut.$\r$\n$\r$\nClick Finish to exit Setup."
  !define MUI_FINISHPAGE_RUN_TEXT "Launch ${RELAY_APP_NAME} now"

  !define MUI_UNWELCOMEPAGE_TITLE "Uninstall ${RELAY_APP_NAME}"
  !define MUI_UNWELCOMEPAGE_TEXT "This wizard will remove ${RELAY_APP_NAME} from your computer.$\r$\n$\r$\nBefore continuing, make sure ${RELAY_APP_NAME} is not running.$\r$\n$\r$\nClick Uninstall to begin."

  !define MUI_UNFINISHPAGE_TITLE "${RELAY_APP_NAME} was removed"
  !define MUI_UNFINISHPAGE_TEXT "${RELAY_APP_NAME} has been uninstalled.$\r$\n$\r$\nMessages on your server are not affected. Local cache may remain on this PC.$\r$\n$\r$\nClick Finish to close."
!macroend

; -----------------------------------------------------------------------------
; Close running RELAY.exe (unique labels per call site)
; -----------------------------------------------------------------------------
!macro relay.closeRunningAppForInstall
  nsExec::ExecToStack 'tasklist /NH /FI "IMAGENAME eq ${RELAY_PROCESS}"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    ${If} $1 != "INFO: No tasks are running which match the specified criteria."
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
        "${RELAY_APP_NAME} is currently running.$\r$\n$\r$\nClick OK to close it and continue installation, or Cancel to abort." \
        IDOK relay_install_kill
      Abort
      relay_install_kill:
      DetailPrint "Closing ${RELAY_APP_NAME}..."
      nsExec::ExecToLog 'taskkill /F /IM "${RELAY_PROCESS}" /T'
      Sleep 900
    ${EndIf}
  ${EndIf}
!macroend

!macro relay.closeRunningAppForUninstall
  nsExec::ExecToStack 'tasklist /NH /FI "IMAGENAME eq ${RELAY_PROCESS}"'
  Pop $0
  Pop $1
  ${If} $1 != ""
    ${If} $1 != "INFO: No tasks are running which match the specified criteria."
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
        "${RELAY_APP_NAME} is currently running.$\r$\n$\r$\nClick OK to close it and continue uninstall, or Cancel to abort." \
        IDOK relay_uninstall_kill
      Abort
      relay_uninstall_kill:
      DetailPrint "Closing ${RELAY_APP_NAME}..."
      nsExec::ExecToLog 'taskkill /F /IM "${RELAY_PROCESS}" /T'
      Sleep 900
    ${EndIf}
  ${EndIf}
!macroend

; -----------------------------------------------------------------------------
; Installer init
; -----------------------------------------------------------------------------
!macro customInit
  !insertmacro relay.closeRunningAppForInstall
!macroend

; -----------------------------------------------------------------------------
; Welcome page (assisted installer does not add this by default)
; -----------------------------------------------------------------------------
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; -----------------------------------------------------------------------------
; After files are installed
; -----------------------------------------------------------------------------
!macro customInstall
  DetailPrint "Finalizing ${RELAY_APP_NAME} installation..."

  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\${RELAY_EXE}" \
    "" "$INSTDIR\${RELAY_EXE}"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\${RELAY_EXE}" \
    "Path" "$INSTDIR"

  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\${RELAY_EXE}"
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Publisher" "RELAY"

  ${ifNot} ${isUpdated}
    DetailPrint "Completed fresh install of ${RELAY_APP_NAME}"
  ${else}
    DetailPrint "Completed update of ${RELAY_APP_NAME}"
  ${endIf}
!macroend

; -----------------------------------------------------------------------------
; Uninstaller welcome
; -----------------------------------------------------------------------------
!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

; -----------------------------------------------------------------------------
; Uninstaller init
; -----------------------------------------------------------------------------
!macro customUnInit
  !insertmacro relay.closeRunningAppForUninstall
!macroend

; -----------------------------------------------------------------------------
; After uninstall
; -----------------------------------------------------------------------------
!macro customUnInstall
  DetailPrint "Cleaning ${RELAY_APP_NAME} registration..."
  DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\App Paths\${RELAY_EXE}"
  DetailPrint "${RELAY_APP_NAME} has been removed."
!macroend
