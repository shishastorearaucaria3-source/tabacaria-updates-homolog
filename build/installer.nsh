; NSIS custom para o instalador NossoSistema-Setup (assistente com pasta escolhivel).
; Pasta padrao sugerida: C:\NossoSistema. O usuario pode alterar na tela do instalador.
; A aplicacao NAO usa este caminho em runtime — ela descobre sua propria pasta via
; dirname(process.execPath). Este valor e apenas o diretorio inicial do instalador.

!macro customInit
  ; Se o usuario/autoupdate informou /D=<pasta> na linha de comando, respeita.
  ; Se NAO informou, define o diretorio padrao sugerido: C:\NossoSistema.
  Push $R0
  !insertmacro GetDParameter $R0
  ${If} $R0 == ""
    StrCpy $INSTDIR "C:\NossoSistema"
  ${EndIf}
  Pop $R0
!macroend

; NAO conceder ACL ampla aqui. O launcher concede permissao de escrita APENAS ao
; usuario atual (nao ao grupo "Users") apos copiar os arquivos — necessario para
; o autoupdate substituir arquivos sem elevacao. Demais usuarios ficam sem escrita.
!macro customInstall
!macroend

; Desinstalador: perguntar se quer manter dados
!macro customUnInstall
  ; Verificar se existe pasta de dados
  Var /GLOBAL _DATA_DIR
  StrCpy $_DATA_DIR "$INSTDIR\sistema-loja-tabacaria"

  IfFileExists "$_DATA_DIR\*.*" 0 _no_data_to_ask

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Deseja remover tambem os dados do sistema?$\n$\nDados encontrados em:$\n$_DATA_DIR$\n$\n(Banco, configuracoes, logs, backups)$\n$\nSe escolher NAO, os dados serao preservados para futura instalacao." \
    IDYES _remove_data IDNO _keep_data

  _remove_data:
    RMDir /r "$_DATA_DIR"
    Goto _no_data_to_ask

  _keep_data:
    ; Nao fazer nada — dados preservados

  _no_data_to_ask:
!macroend