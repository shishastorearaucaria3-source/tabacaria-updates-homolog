; ============================================================================
; installer.nsh — NossoSistema NSIS custom installer
; ============================================================================

!macro customHeader
!macroend

!macro customInit
  Push $R0
  !insertmacro GetDParameter $R0
  ${If} $R0 == ""
    StrCpy $INSTDIR "C:\NossoSistema"
  ${EndIf}
  Pop $R0
  CreateDirectory "$INSTDIR"
!macroend

!macro customPageAfterChangeDir
  Var NossoSistema_Tipo
  Var NossoSistema_RadioCli
  Var NossoSistema_RadioSrv

  Page custom fnSelectComponentes fnSelectComponentesLeave

  Function fnSelectComponentes
    StrCpy $NossoSistema_Tipo "servidor"

    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0 0 100% 20u "Selecione os componentes que deseja instalar:"
    Pop $0

    ${NSD_CreateRadioButton} 0 30u 100% 14u "Somente NossoSistema"
    Pop $NossoSistema_RadioCli

    ${NSD_CreateLabel} 20u 44u 80% 14u "Instala apenas o aplicativo/PDV. Conecta a um servidor existente."
    Pop $0

    ${NSD_CreateRadioButton} 0 64u 100% 14u "NossoSistema + Servidor"
    Pop $NossoSistema_RadioSrv

    ${NSD_CreateLabel} 20u 78u 80% 14u "Instala o servidor local, API, banco de dados e aplicativo completo."
    Pop $0

    SendMessage $NossoSistema_RadioSrv ${BM_SETCHECK} ${BST_CHECKED} 0

    nsDialogs::Show
  FunctionEnd

  Function fnSelectComponentesLeave
    ${NSD_GetState} $NossoSistema_RadioCli $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $NossoSistema_Tipo "cliente"
    ${Else}
      StrCpy $NossoSistema_Tipo "servidor"
    ${EndIf}
  FunctionEnd
!macroend

!macro customInstall
  DetailPrint "Instalando componentes do sistema..."
  ExecWait '"$INSTDIR\NossoSistema.exe" /S /TIPO=$NossoSistema_Tipo'
!macroend

!macro customUnInstall
  Delete "$DESKTOP\NossoSistema.lnk"
  Delete "$DESKTOP\NossoSistema-Servidor.lnk"
  RMDir /r "$SMPROGRAMS\NossoSistema"

  Delete "$DESKTOP\NossoSistema Servidor.lnk"
  Delete "$DESKTOP\Servidor.lnk"
  Delete "$DESKTOP\Iniciar Servidor.lnk"
  Delete "$DESKTOP\Parar Servidor.lnk"
  Delete "$DESKTOP\Sistema Loja Tabacaria.lnk"
  Delete "$SMPROGRAMS\Sistema Loja Tabacaria.lnk"

  Delete "$INSTDIR\NossoSistema-Servidor.exe"
  Delete "$INSTDIR\Servidor.exe"
  Delete "$INSTDIR\NossoSistema.exe"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\br.com.lojatabacaria.sistema"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "NossoSistema Servidor"

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="NossoSistema Servidor"'

  IfFileExists "$INSTDIR\sistema-loja-tabacaria\*.*" 0 +3
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Deseja remover tambem os dados do sistema?$\n$\nDados: $INSTDIR\sistema-loja-tabacaria$\n$\n(Banco, configuracoes, logs, backups)" \
      IDYES +2 IDNO +1
    RMDir /r "$INSTDIR\sistema-loja-tabacaria"
!macroend
