; Extends electron-builder's generated NSIS script — this file is included
; by default (`nsis.include` defaults to `build/installer.nsh`, undocumented
; anywhere but the option's own doc comment in `nsisOptions.d.ts`).
;
; electron-builder already closes ${APP_EXECUTABLE_FILENAME} (Shashoku.exe)
; before install and uninstall, gracefully and then by force, with its own
; user-facing retry dialog — see `CHECK_APP_RUNNING` in its
; `allowOnlyOneInstallerInstance.nsh` template. What it cannot know about is
; the OCR/inpaint sidecar: a Python process this one spawns with
; `child_process.spawn`, not a Windows job object, so killing Shashoku.exe
; does not take python.exe down with it. Left running, it keeps every file
; under `py\` and `site\` locked, and the copy a few steps later fails on
; exactly those files. `customCheckAppRunning` below keeps the stock
; app-closing behaviour and appends closing the sidecar too — read together
; with `electron/ipc/ocr.ts`'s `before-quit` handler, which is the other half
; of the same fix for the case where the app is asked to quit normally rather
; than killed by an installer.
;
; `_CHECK_APP_RUNNING` (electron-builder's default, reused below) needs
; `getProcessInfo.nsh` and `$pid`. Its own template only pulls those in when
; `customCheckAppRunning` is *not* defined — since this file defines it, that
; guard is skipped, so both are declared here instead.
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !insertmacro KILL_ENGINE_PROCESS
!macroend

; Matched by path, not by image name alone: "python.exe" is common enough on
; a developer's machine that killing every process with that name would take
; out work that has nothing to do with Shashoku. Skipped outright when
; PowerShell is unavailable rather than falling back to a name-only match,
; for the same reason — `$IsPowerShellAvailable` is set by
; `IS_POWERSHELL_AVAILABLE` above, which always runs first.
!macro KILL_ENGINE_PROCESS
  ${if} $IsPowerShellAvailable == 0
    DetailPrint "Closing the OCR engine, if it is still running..."
    nsExec::Exec `"$PowerShellPath" -C "Get-CimInstance -ClassName Win32_Process | ? {$$_.Name -ieq 'python.exe' -and $$_.Path -and $$_.Path.StartsWith('$INSTDIR\py\', 'CurrentCultureIgnoreCase')} | % { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
    Pop $0
    Sleep 300
  ${else}
    DetailPrint "PowerShell is unavailable; could not confirm the OCR engine is closed."
  ${endIf}
!macroend

; ---------------------------------------------------------------------------
; RMDir with logging and reboot-safe fallback, ported from Comfy Desktop's
; `installer.nsh` (Comfy-Org/desktop, scripts/installer.nsh) — cited in
; `Windows打包/spec.md`〈④ 安裝檔的行為〉 as the shape worth copying.
;
; `RMDir /r` alone, which is what electron-builder's own uninstaller falls
; back to, does not pass `/REBOOTOK`: a locked file is silently left behind
; instead of being scheduled for the next boot. `/REBOOTOK` fixes that, but
; introduces a new problem this macro exists to solve — telling "this call
; just scheduled a reboot" apart from "a reboot was already scheduled by an
; earlier step in the same uninstall run" (for us: the models directory can
; be removed before $INSTDIR is, see `customUnInstall` below). Snapshotting
; the reboot flag before the call and OR-ing it back in afterward is what
; makes that distinction possible, rather than one step's success silently
; clearing another step's pending-reboot flag.
; ---------------------------------------------------------------------------
; Labels are namespaced by `__LINE__` because `RMDIR_LOGGED` below calls this
; twice (before and after) and is itself called twice (models, then
; $INSTDIR) in the same uninstall Section — fixed label names would collide
; the second time either macro expands into that Section.
!macro GET_REBOOTFLAG_TO_VAR _outVar
  !define _LBL_SET "rf_set_${__LINE__}"
  !define _LBL_DONE "rf_done_${__LINE__}"

  StrCpy ${_outVar} "0"
  IfRebootFlag ${_LBL_SET}
  Goto ${_LBL_DONE}
  ${_LBL_SET}:
    StrCpy ${_outVar} "1"
  ${_LBL_DONE}:

  !undef _LBL_SET
  !undef _LBL_DONE
!macroend

!macro RMDIR_LOGGED _path _description
  Push $0
  Push $1

  !insertmacro GET_REBOOTFLAG_TO_VAR $0

  DetailPrint "Removing ${_description}: ${_path}"
  SetRebootFlag false
  ClearErrors
  RMDir /r /REBOOTOK "${_path}"

  ${If} ${Errors}
    DetailPrint "[Error] Failed to remove ${_description}: ${_path}"
  ${Else}
    !insertmacro GET_REBOOTFLAG_TO_VAR $1
    ${If} $1 == "1"
      DetailPrint "[Reboot] Scheduled removal of ${_description}: ${_path}"
    ${Else}
      DetailPrint "[OK] Removed ${_description}: ${_path}"
    ${EndIf}
  ${EndIf}

  ${If} $0 == "1"
  ${OrIf} $1 == "1"
    SetRebootFlag true
  ${EndIf}

  Pop $1
  Pop $0
!macroend

; ---------------------------------------------------------------------------
; Uninstall: standard vs custom.
;
; Standard removes the app and its Python environment ($INSTDIR, via the
; stock `customRemoveFiles` fallback below) and, via `deleteAppDataOnUninstall`
; in electron-builder.yml, the app's own settings and logs. It does not touch
; downloaded models — those can be gigabytes and are exactly what the ticket
; asks not to lose to an accidental uninstall.
;
; The only opt-in this adds is the models directory
; ($LOCALAPPDATA\Shashoku\models, matching `electron/lib/modelHome.ts`'s
; `resolveModelHome` for win32 exactly). Checking it does not delete anything
; by itself — leaving the confirmation page's checkbox unchecked reverts the
; choice, same as Comfy's `ConfirmDeleteBasePath` page.
;
; There is no equivalent control for the user's projects: those are plain
; files the user opens from wherever they saved them, and nothing here
; tracks where that is. There is nothing to offer a checkbox for.
; ---------------------------------------------------------------------------
!ifdef BUILD_UNINSTALLER
  Var deleteModelsChoice
  Var deleteModelsConfirmed
  Var modelsCheckbox
  Var confirmCheckbox

  !macro customUnInit
    StrCpy $deleteModelsChoice "0"
    StrCpy $deleteModelsConfirmed "0"
  !macroend

  !macro customUnWelcomePage
    !insertmacro MUI_UNPAGE_WELCOME
    UninstPage custom un.ModelsPage_Create un.ModelsPage_Leave
    UninstPage custom un.ConfirmModelsPage_Create un.ConfirmModelsPage_Leave
  !macroend

  Function un.ModelsPage_Create
    ; No `MUI_HEADER_TEXT` here: this file's content is spliced in by
    ; electron-builder *before* `installer.nsi`'s own `!include "MUI2.nsh"`
    ; (see `computeCommonInstallerScriptHeader()` in electron-builder's
    ; `NsisTarget.js`, HEAD `44a10d4`), so a macro from that file used inside
    ; a plain `Function` here — compiled immediately, unlike a `!macro` body,
    ; which is only expanded later at its own insertion point — would not
    ; exist yet. The label below carries the page's own title instead.
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 12u "Remove downloaded models?"
    Pop $0

    ${NSD_CreateLabel} 0 16u 100% 36u "Standard uninstall removes Shashoku and its Python environment, but leaves your downloaded models and any projects alone.$\r$\n$\r$\nTick the box below only if you also want the downloaded models deleted."
    Pop $0

    ${NSD_CreateCheckBox} 0 60u 100% 12u "Also delete downloaded models ($LOCALAPPDATA\Shashoku\models)"
    Pop $modelsCheckbox
    ${NSD_SetState} $modelsCheckbox 0

    ${IfNot} ${FileExists} "$LOCALAPPDATA\Shashoku\models\*.*"
      EnableWindow $modelsCheckbox 0
      ${NSD_SetText} $modelsCheckbox "No downloaded models were found."
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function un.ModelsPage_Leave
    ${NSD_GetState} $modelsCheckbox $0
    ${If} $0 == 1
      StrCpy $deleteModelsChoice "1"
    ${Else}
      StrCpy $deleteModelsChoice "0"
    ${EndIf}
  FunctionEnd

  ; Skipped entirely unless the previous page's box was ticked — same guard
  ; Comfy's `ConfirmDeleteBasePath_Create` uses for its own irreversible
  ; delete.
  Function un.ConfirmModelsPage_Create
    ${IfNot} $deleteModelsChoice == "1"
      Abort
    ${EndIf}

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 12u "Are you sure?"
    Pop $0

    ${NSD_CreateLabel} 0 16u 100% 24u "This permanently deletes every model Shashoku has downloaded. They will be downloaded again the next time you use a feature that needs them."
    Pop $0

    ${NSD_CreateLabel} 0 44u 100% 12u "$LOCALAPPDATA\Shashoku\models"
    Pop $0

    ${NSD_CreateCheckBox} 0 64u 100% 12u "Yes, delete the downloaded models"
    Pop $confirmCheckbox
    ${NSD_SetState} $confirmCheckbox 0

    nsDialogs::Show
  FunctionEnd

  Function un.ConfirmModelsPage_Leave
    ${NSD_GetState} $confirmCheckbox $0
    ${If} $0 == 1
      StrCpy $deleteModelsConfirmed "1"
    ${Else}
      StrCpy $deleteModelsConfirmed "0"
    ${EndIf}
  FunctionEnd

  ; Runs inside the uninstall Section, before the files are removed —
  ; ordering that does not matter for this path (it is outside $INSTDIR
  ; entirely) but does matter for `RMDIR_LOGGED`'s reboot-flag test: this
  ; call has to happen before the one for $INSTDIR below so a lock on a
  ; model file, not just a lock on an app file, is what the OR-preserving
  ; logic is proven against.
  !macro customUnInstall
    ${If} $deleteModelsChoice == "1"
    ${AndIf} $deleteModelsConfirmed == "1"
      !insertmacro RMDIR_LOGGED "$LOCALAPPDATA\Shashoku\models" "downloaded models"
    ${EndIf}
  !macroend

  ; The `isUpdated` branch reproduces electron-builder's own atomic
  ; rename-away-then-restore dance (see its `uninstaller.nsh`), which is what
  ; lets a silent update reinstall roll back if the copy that follows fails.
  ; The plain-uninstall branch swaps upstream's `RMDir /r $INSTDIR` for
  ; `RMDIR_LOGGED`, so a file still locked here (something CHECK_APP_RUNNING
  ; did not catch) is scheduled for the next boot instead of silently left
  ; behind.
  ;
  ; TODO: this is not a faithful port of upstream's structure. Upstream closes
  ; the `isUpdated` block with `${endif}` and then runs `SetOutPath $TEMP` and
  ; `RMDir /r $INSTDIR` unconditionally — clearing whatever shallow
  ; directories the rename left behind, and moving the uninstaller's own
  ; working directory out of $INSTDIR first, since NSIS cannot delete the
  ; current working directory. Turning that `${endif}` into the `${else}`
  ; below drops both of those from the update path.
  !macro customRemoveFiles
    ${if} ${isUpdated}
      CreateDirectory "$PLUGINSDIR\old-install"

      Push ""
      Call un.atomicRMDir
      Pop $R0

      ${if} $R0 != 0
        DetailPrint "File is busy, aborting: $R0"
        Push ""
        Call un.restoreFiles
        Pop $R0
        Abort `Can't rename "$INSTDIR" to "$PLUGINSDIR\old-install".`
      ${endif}
    ${else}
      SetOutPath $TEMP
      !insertmacro RMDIR_LOGGED "$INSTDIR" "the application"
    ${endif}
  !macroend
!endif
