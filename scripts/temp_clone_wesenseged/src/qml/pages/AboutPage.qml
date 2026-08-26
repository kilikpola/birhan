// SPDX-FileCopyrightText: 2026 Abenezer Wesenseged <wseged@proton.me>
//
// SPDX-License-Identifier: GPL-3.0-or-later

import QtQuick 2.15
import org.kde.kirigami 2.20 as Kirigami
import org.wesen.about

Kirigami.AboutPage {
    id: aboutPage
    aboutData: {
        "displayName": "Amharic bible",
        "shortDescription": "Offline Amharic Bible reader for KDE",
        "homepage": "",
        "bugAddress": "",
        "version": "1.0",
        "authors": [
            {
                "name": "Abenezer Wesenseged",
                "task": "Developer & Maintainer",
                "emailAddress": "wseged@proton.me",
                "webAddress": "https://wesen.vercel.app"
            }
        ],
        "credits": [
            {
                "name": "WordProject",
                "task": "Amharic bible text",
                "webAddress": "https://wordproject.org"
            }
        ],
        "licenses": [
            {
                "name": "GPLv3 + WordProject Text Notice",
                "text": "This application is licensed under the GNU General Public License v3.0.\n\nHowever, the Amharic Bible text included in this app is © WordProject and used with permission.\nYou must contact WordProject directly if you plan to reuse or distribute these texts outside of this application.\n\nVisit https://www.wordproject.org/contact/ for more information.",
                "spdx": "GPL-3.0"
            }
        ],
        "copyrightStatement": "© 2026 Wesenseged",
        "desktopFileName": "io.github.wesenseged.Amharic-bible"
    }
}
