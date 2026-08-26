// SPDX-FileCopyrightText: 2026 Abenezer Wesenseged <wseged@proton.me>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls as Controls
import org.kde.kirigami as Kirigami

Item {
    id: headerRoot
    height: chapterCount > 100 ? 340 : 200
    property int chapterCount: 0
    property int selectedChapter: 1

    signal chapterRequested(int chapterNumber)
    Layout.fillWidth: true
    Layout.fillHeight: true

    ColumnLayout {
        anchors.fill: parent
        spacing: 20

        GridLayout {
            columns: 23
            columnSpacing: 4
            Layout.alignment: Qt.AlignHCenter

            Repeater {
                id: chapterRepeater
                model: headerRoot.chapterCount
                delegate: Controls.Button {
                    id: chapterBtn
                    text: index + 1
                    width: 36
                    height: 36
                    hoverEnabled: true

                    background: Rectangle {
                        color: chapterBtn.hovered ? Kirigami.Theme.negativeTextColor : (headerRoot.selectedChapter === index + 1 ? Kirigami.Theme.negativeTextColor : Kirigami.Theme.backgroundColor)
                        radius: 6
                        Controls.Label {
                            anchors.centerIn: parent
                            text: i18n("%1", index + 1)
                            font.pointSize: 8
                            color: chapterBtn.hovered ? Kirigami.Theme.textColor : (headerRoot.selectedChapter === index + 1 ? Kirigami.Theme.textColor : Kirigami.Theme.negativeTextColor)
                        }
                    }

                    onClicked: {
                        headerRoot.selectedChapter = index + 1;
                        headerRoot.chapterRequested(headerRoot.selectedChapter); // Emit the signal with a parameter.
                    }
                }
            }
        }

        Kirigami.Heading {
            text: i18n("ምዕራፍ %1", headerRoot.selectedChapter)
            font.pointSize: 24
            color: Kirigami.Theme.negativeTextColor
            Layout.alignment: Qt.AlignCenter
        }
    }
}
