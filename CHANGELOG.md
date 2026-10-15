# Registro delle modifiche di MarX

La versione corrente è in `config/marx.php`.
Formato: MAGGIORE.MINORE.CORREZIONE. Ogni gruppo di funzioni nuove aumenta il numero MINORE; le sole correzioni aumentano CORREZIONE.

## 0.10.1 — 2026-10-15
- Dock personalizzabile come sul Mac, salvato nell'account: trascina un'app dal Launchpad nel Dock per fissarla, trascina le icone per riordinarle, trascinale fuori dal Dock per toglierle (il Finder resta sempre).
- Le app aperte ma non fissate compaiono in una sezione a parte; dal tasto destro «Mantieni nel Dock» o «Rimuovi dal Dock».
- File e cartelle nella parte destra del Dock: trascinali dal Finder o dalla scrivania; una cartella si apre a griglia con il suo contenuto.
- Trascinare un file su TextEdit nel Dock lo apre in TextEdit; sul Finder lo mostra nella sua cartella.

## 0.10.0 «Organizzazione» — 2026-10-15
- Promemoria: liste colorate, viste Oggi, Programmati, Tutti, Con bandiera e Completati, scadenze con ora, priorità, bandiera, note; avviso nel Centro notifiche alla scadenza.
- Calendario completo: viste giorno, settimana e mese, più calendari colorati da mostrare o nascondere, eventi ripetuti (giornalieri, settimanali, mensili, annuali), eventi di tutto il giorno, avvisi prima dell'inizio.
- Contatti: rubrica con telefoni, email, indirizzi, compleanno, sito, note e foto; preferiti e ricerca; importazione ed esportazione vCard (iPhone, Android, Outlook).
- TextEdit: crea e modifica file di testo e Markdown (con anteprima affiancata) direttamente dal Finder e dalla scrivania; avviso se chiudi senza salvare.
- Scrivania: le icone si spostano dove vuoi e restano lì su ogni dispositivo; «Mantieni allineate», «Riordina» e «Ordina per» dal tasto destro; trascinando un'icona su una cartella, sul Finder o sul Cestino si sposta il file.

## 0.9.2 — 2026-10-15
- «Info su MarX» ha i pulsanti «Novità» e «Aggiornamento software…».

## 0.9.1 — 2026-10-15
- Correzione: il numero di download dei link condivisi appena creati ora mostra 0 invece di un valore vuoto.
- Aggiornamento software: le librerie vengono installate rispettando i permessi del server (il primo tentativo di aggiornamento falliva e tornava alla versione precedente).

## 0.9.0 «File» — 2026-10-15
- Finder con tre viste (icone, elenco ordinabile, colonne con anteprima), selezione multipla (Ctrl/Maiusc e riquadro) e scorciatoie da tastiera.
- Cestino vero: ripristino nella cartella d'origine, svuotamento, eliminazione automatica dopo 30 giorni, icona del Dock piena o vuota.
- Quick Look con la barra spaziatrice per immagini, PDF, video, audio e testo; le frecce scorrono i file della cartella.
- Tag colorati con la sezione Tag nella barra laterale.
- ZIP: comprimi ed estrai, con blocco degli archivi malevoli e degli archivi «bomba».
- Trascinamento verso cartelle, barra laterale, scrivania e Cestino del Dock.
- Condivisione: link pubblici con scadenza, password facoltativa e revoca; condivisione in sola lettura con altri utenti («Condivisi con me»).
- Scrivania collegata alla cartella «Scrivania», con le pile per tipo di file.

## 0.8.0 «Notifiche» — 2026-10-14
- Centro notifiche, aperto dall'orologio, con widget (ora, calendario, note recenti) e storico delle notifiche.
- Non disturbare: per 1 ora, fino a stasera, fino a domani o senza scadenza.
- Suoni di sistema sintetizzati: notifiche (Vetro, Gocce, Campanello), cestino, avvio.
- Salvaschermo: Orologio, Aurora, Bolle.
- Scorciatoie da tastiera personalizzabili (Impostazioni › Tastiera).
- Spotlight cerca anche nelle note, nei file e sul web (webX).
- Gestione degli utenti per gli amministratori.

## 0.7.0 «Finestre» — 2026-10-14
- Mission Control con le scrivanie multiple: creare, rimuovere, spostare finestre trascinandole.
- Affiancamento delle finestre ai bordi e negli angoli, anche da tastiera.
- Passaggio rapido tra le app (Alt+Q), Stage Manager, Mostra scrivania, angoli attivi.

## 0.6.0 «Impostazioni» — 2026-10-14
- Impostazioni in stile Impostazioni di Sistema, con barra laterale e ricerca, salvate nell'account.
- Sfondi personalizzati (immagine o colore), colore principale, Dock configurabile, blocco automatico.
- Puntatori in stile Mac e impostazioni del mouse.
- Ripristino delle finestre aperte dopo l'aggiornamento della pagina.
- Browser webX con schede, preferiti e cronologia.

## 0.5.0 «Soft Store» — 2026-10-14
- Soft Store: installazione di app Docker con un clic (catalogo MarX e catalogo della community), ognuna con il suo indirizzo HTTPS e limiti di risorse.
- Monitoraggio Attività: CPU, memoria e disco del server, consumo di ogni app.
- Agente separato (`marx-agent`) che è l'unico autorizzato a usare Docker.

## 0.4.0 «Liquid Glass» — 2026-10-14
- Grafica in vetro liquido, barra dei menu trasparente, finestre con angoli ampi.
- Effetto Genio, ingrandimento del Dock, animazioni di apertura e chiusura.

## 0.3.0 «Menu» — 2026-10-14
- Barra dei menu con i menu propri di ogni app e le Impostazioni dell'app.
- Tasto destro su scrivania, Dock, finestre e contenuti.
- Ridimensionamento delle finestre da tutti i bordi e gli angoli.

## 0.2.0 «Account» — 2026-10-14
- Accesso con email e password, blocco schermo, database MariaDB.
- Finder con file veri sul server (cartelle, caricamento, anteprima), Note salvate nel database.

## 0.1.0 — 2026-10-14
- Prima scrivania in stile macOS: barra dei menu, Dock, finestre, Launchpad, Spotlight, Calcolatrice, Calendario.
