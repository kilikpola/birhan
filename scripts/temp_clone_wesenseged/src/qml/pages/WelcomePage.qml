// SPDX-FileCopyrightText: 2026 Abenezer Wesenseged <wseged@proton.me>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as Controls
import org.kde.kirigami as Kirigami

Kirigami.ScrollablePage {
    id: welcomePage

    property ListModel oldTestamentModels: ListModel {}
    property ListModel newTestamentModels: ListModel {}

    Component.onCompleted: {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "qrc:/data/books.json");
        xhr.onreadystatechange = function () {
            if (xhr.readyState === XMLHttpRequest.DONE) {
                if (xhr.status === 0 || xhr.status === 200) {
                    var json = JSON.parse(xhr.responseText);

                    oldTestamentModels.clear();
                    newTestamentModels.clear();

                    for (var i = 0; i < json.oldTestament.length; i++) {
                        oldTestamentModels.append(json.oldTestament[i]);
                    }
                    for (var j = 0; j < json.newTestament.length; j++) {
                        newTestamentModels.append(json.newTestament[j]);
                    }
                } else {
                    console.log("❌ Failed to load JSON", xhr.status);
                }
            }
        };
        xhr.send();
    }

    ColumnLayout {
        width: parent.width
        spacing: 15

        Kirigami.Heading {
            level: 1
            text: "መጽሐፍ ቅዱስ"
        }

        Controls.Label {
            text: "Amharic Bible"
        }

        Item {
            Layout.preferredHeight: 20
        }

        RowLayout {
            id: rowLayout
            Layout.alignment: Qt.AlignHCenter
            spacing: 40

            // 📖 Old Testament
            Testimonial {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignTop
                title: "ብሉይ ኪዳን"
                testModel: welcomePage.oldTestamentModels
            }

            // 📖 New Testament
            Testimonial {
                Layout.fillWidth: true
                Layout.alignment: Qt.AlignTop
                title: "አዲስ ኪዳን"
                testModel: welcomePage.newTestamentModels
            }
        }
    }
}
