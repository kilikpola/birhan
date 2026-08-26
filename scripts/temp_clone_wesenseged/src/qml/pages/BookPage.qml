// SPDX-FileCopyrightText: 2026 Abenezer Wesenseged <wseged@proton.me>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import QtQml 2.15
import QtCore
import QtQuick.Layouts 1.15
import QtQuick.Controls 2.15 as Controls
import org.kde.kirigami 2.15 as Kirigami

Kirigami.ScrollablePage {
    id: bookPage

    property int minFontSize: 10
    property int maxFontSize: 30
    property var fontSize: settings.fontSize
    onFontSizeChanged: settings.fontSize = fontSize
    property string bookName: ""
    property int chapterCount: 0
    property string dataFile: ""
    property int selectedChapter: 1

    property ListModel versesModel: ListModel {}

    Settings {
        id: settings
        category: "General"
        property int fontSize: 16
    }

    function loadchapter(boo) {
        if (bookPage.dataFile !== "") {
            var xhr = new XMLHttpRequest();

            xhr.open("GET", Qt.resolvedUrl(bookPage.dataFile));
            xhr.onreadystatechange = function () {
                if (xhr.readyState === XMLHttpRequest.DONE && (xhr.status === 0 || xhr.status === 200)) {
                    var json = JSON.parse(xhr.responseText);
                    versesModel.clear();
                    var chapter = json.book[boo - 1];
                    for (var j = 0; j < chapter.verses.length; j++) {
                        var v = chapter.verses[j];
                        versesModel.append({
                            number: v.verse,
                            verse: v.text
                        });
                    }
                }
            };
            xhr.send();
        }
    }

    actions: [
        Kirigami.Action {
            icon.name: "zoom-in"
            shortcut: "Ctrl++"
            enabled: bookPage.fontSize < bookPage.maxFontSize
            onTriggered: {
                bookPage.fontSize += 2;
            }
        },
        Kirigami.Action {
            icon.name: "zoom-out"
            shortcut: "Ctrl+-"
            enabled: bookPage.fontSize > bookPage.minFontSize
            onTriggered: {
                bookPage.fontSize -= 2;
            }
        }
    ]

    Component.onCompleted: loadchapter(1)

    ColumnLayout {
        id: contentLayout
        spacing: 20
        width: parent.width
        Kirigami.Heading {
            text: bookPage.bookName
            font.pointSize: 40
            font.bold: true
        }

        DefaultHeader {
            chapterCount: bookPage.chapterCount
            selectedChapter: bookPage.selectedChapter
            onChapterRequested: chapterNumber => {
                loadchapter(chapterNumber);
            }
        }

        Repeater {
            model: bookPage.versesModel
            Layout.preferredWidth: 400
            Layout.alignment: Qt.AlignHCenter
            delegate: RowLayout {
                Layout.fillWidth: true
                Layout.leftMargin: Kirigami.Units.largeSpacing

                Kirigami.Heading {
                    text: number
                    color: Kirigami.Theme.negativeTextColor
                    font.pointSize: bookPage.fontSize
                }
                Controls.Label {
                    text: verse
                    wrapMode: Text.WordWrap
                    Layout.fillWidth: true
                    font.pointSize: bookPage.fontSize
                }
            }
        }
    }
}
