# Kontaktbuch

Installierbare, statische PWA fuer ein bestehendes Radicale-CardDAV.

Die App spricht direkt aus dem Browser mit dem in den Einstellungen angegebenen CardDAV-Server. Es gibt keinen eigenen Backend-Dienst und keinen API-Proxy. Server, Benutzername und Passwort werden im Einstellungsbereich abgefragt; das Passwort kann optional nur im lokalen Speicher des iPhones gemerkt werden. Auf Desktop-Bildschirmen können Kontakte außerdem bearbeitet, gelöscht und mit einem zweiten Kontakt zusammengeführt werden. Änderungen werden direkt per CardDAV gespeichert. Die Kontaktliste bietet eine Buchstabennavigation mit sichtbaren Kartenfenstern, damit auch grosse Adressbuecher schnell durchsucht werden koennen.
Adressbuecher und Kontakte werden lokal gecacht und beim Oeffnen sofort angezeigt. Der Abgleich mit Radicale erfolgt nur ueber den manuellen Synchronisieren-Button. Die Kontaktliste rendert zuerst 40 Karten und laedt beim Scrollen weitere Bloecke nach.
Neue App-Versionen werden beim Start, beim Zurueckkehren in die App und regelmaessig waehrend die App geoeffnet ist per Service Worker geprueft und automatisch aktiviert.

## Voraussetzungen

- Auslieferung ueber HTTPS, damit Safari die PWA installieren darf.
- Die App muss entweder unter derselben Origin wie Radicale laufen oder Radicale muss CORS fuer die App-Origin erlauben.
- Fuer den vorhandenen Server ist der voreingestellte Endpunkt `https://dav.zp1.net/`.

## Lokaler Test

Mit PHP kann die statische App lokal gestartet werden:

```text
php -S localhost:8080
```

Dann `http://localhost:8080/` im Browser oeffnen. Der Zugriff auf `dav.zp1.net` benoetigt fuer einen lokalen Test passende CORS-Header auf Radicale.

## Safari-Installation

Die App ueber eine HTTPS-Adresse in Safari oeffnen und ueber Teilen > Zum Home-Bildschirm hinzufuegen installieren.
