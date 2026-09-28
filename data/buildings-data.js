window.ANIIMO_BUILDINGS_DATA = {
  "schemaVersion": 1,
  "notes": [
    "Real Homeland facility names, work abilities and unlock levels from aniimo.gg (shipped game data) and AniimoTools' station pages, checked 2026-09-28.",
    "Every production facility has 1 Aniimo slot per facility (aniimo.gg 'Pet slots: 1'). Upgrading a facility (Level 1, 2, ...) adds recipes, not slots.",
    "requirements.minLevel is 1 because any level can work a station; recipes recommend a level (recommendedLevel) and Aniimo above it work faster, below it slower.",
    "Farmland and Woodland are shared intermittent workloads: four steps (Earth, Grass, Water, Dark), with one Aniimo per step able to cover several plots (AniimoTools uses 8).",
    "Hatchinator also has 1 Aniimo slot on aniimo.gg but no work type is documented, so it is omitted.",
    "maxByRv is placementLimit as data: each {rv, max} step gives how many of the building you can place from that RV level on. The planner fills building counts with the max for the chosen RV level. Farmland, Woodland and Mine steps (maxByRvVerified: false) come from the RV upgrade requirements; see maxByRvNotes."
  ],
  "sources": [
    {
      "name": "AniimoTools – Home stations: who works where",
      "url": "https://aniimotools.dev/systems/homeland/stations/",
      "notes": "Which ability each building needs, and how Farmland and Woodland work is split into steps."
    },
    {
      "name": "aniimo.gg – Homeland furniture and facilities",
      "url": "https://aniimo.gg/homeland/furniture/functional-facilities/",
      "notes": "Building names, how many Aniimo each one holds (one each) and when they unlock."
    },
    {
      "name": "aniimo.gg – Homeland work abilities",
      "url": "https://aniimo.gg/homeland/work/",
      "notes": "The 13 Homeland abilities that buildings ask for."
    }
  ],
  "buildings": [
    {
      "id": "farmland",
      "name": "Farmland",
      "category": "Agriculture",
      "behavior": "intermittent",
      "countLabel": "plots",
      "defaultCount": 8,
      "defaultEnabled": true,
      "pools": [
        {
          "skill": "Earth",
          "jobsPerUnit": 1,
          "label": "loosening soil"
        },
        {
          "skill": "Grass",
          "jobsPerUnit": 1,
          "label": "planting"
        },
        {
          "skill": "Water",
          "jobsPerUnit": 1,
          "label": "watering"
        },
        {
          "skill": "Dark",
          "jobsPerUnit": 1,
          "label": "harvesting"
        }
      ],
      "plotsPerWorker": 8,
      "unlockRv": 1,
      "placementLimit": "4 from RV 1, up to 40 from RV 19",
      "maxByRv": [
        {
          "rv": 1,
          "max": 4
        },
        {
          "rv": 2,
          "max": 6
        },
        {
          "rv": 3,
          "max": 8
        },
        {
          "rv": 4,
          "max": 10
        },
        {
          "rv": 5,
          "max": 12
        },
        {
          "rv": 6,
          "max": 14
        },
        {
          "rv": 7,
          "max": 16
        },
        {
          "rv": 8,
          "max": 18
        },
        {
          "rv": 9,
          "max": 20
        },
        {
          "rv": 10,
          "max": 22
        },
        {
          "rv": 11,
          "max": 24
        },
        {
          "rv": 12,
          "max": 26
        },
        {
          "rv": 13,
          "max": 28
        },
        {
          "rv": 14,
          "max": 30
        },
        {
          "rv": 15,
          "max": 32
        },
        {
          "rv": 16,
          "max": 34
        },
        {
          "rv": 17,
          "max": 36
        },
        {
          "rv": 18,
          "max": 38
        },
        {
          "rv": 19,
          "max": 40
        }
      ],
      "maxByRvVerified": false,
      "maxByRvNotes": "Intermediate steps come from the RV upgrade requirements (to build RV N+1 the game asks you to place this many at RV N, e.g. \"Place 18 farmlands\" before RV 10). They match both published end points (4 from RV 1, up to 40 from RV 19) but the in-game cap at each level has not been confirmed directly.",
      "maxByRvSource": "https://aniimotools.dev/systems/homeland/rv-levels/",
      "recommendedLevel": "1",
      "notes": "Worked by Earth, Grass, Water and Dark Aniimo, each doing its own step. A shared crew covers several plots: AniimoTools' simulator uses 1 Aniimo per job for every 8 plots.",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/farmland/",
        "https://aniimo.gg/homeland/object/farmland-level-1/",
        "https://aniimotools.dev/systems/homeland/production-simulator/"
      ],
      "verified": true
    },
    {
      "id": "woodland",
      "name": "Woodland",
      "category": "Agriculture",
      "behavior": "intermittent",
      "countLabel": "plots",
      "defaultCount": 4,
      "defaultEnabled": true,
      "pools": [
        {
          "skill": "Earth",
          "jobsPerUnit": 1,
          "label": "loosening soil"
        },
        {
          "skill": "Grass",
          "jobsPerUnit": 1,
          "label": "planting"
        },
        {
          "skill": "Water",
          "jobsPerUnit": 1,
          "label": "watering"
        },
        {
          "skill": "Dark",
          "jobsPerUnit": 1,
          "label": "harvesting"
        }
      ],
      "plotsPerWorker": 8,
      "unlockRv": 2,
      "placementLimit": "3 from RV 2, up to 20 from RV 19",
      "maxByRv": [
        {
          "rv": 2,
          "max": 3
        },
        {
          "rv": 3,
          "max": 4
        },
        {
          "rv": 4,
          "max": 5
        },
        {
          "rv": 5,
          "max": 6
        },
        {
          "rv": 6,
          "max": 7
        },
        {
          "rv": 7,
          "max": 8
        },
        {
          "rv": 8,
          "max": 9
        },
        {
          "rv": 9,
          "max": 10
        },
        {
          "rv": 10,
          "max": 11
        },
        {
          "rv": 11,
          "max": 12
        },
        {
          "rv": 12,
          "max": 13
        },
        {
          "rv": 13,
          "max": 14
        },
        {
          "rv": 14,
          "max": 15
        },
        {
          "rv": 15,
          "max": 16
        },
        {
          "rv": 16,
          "max": 17
        },
        {
          "rv": 17,
          "max": 18
        },
        {
          "rv": 18,
          "max": 19
        },
        {
          "rv": 19,
          "max": 20
        }
      ],
      "maxByRvVerified": false,
      "maxByRvNotes": "Intermediate steps come from the RV upgrade requirements (to build RV N+1 the game asks you to place this many at RV N, e.g. \"Place 18 farmlands\" before RV 10). They match both published end points (3 from RV 2, up to 20 from RV 19) but the in-game cap at each level has not been confirmed directly.",
      "maxByRvSource": "https://aniimotools.dev/systems/homeland/rv-levels/",
      "recommendedLevel": "1",
      "notes": "Same four work steps as Farmland (Earth, Grass, Water, Dark). AniimoTools' simulator uses 1 Aniimo per job for every 8 plots.",
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/woodland/",
        "https://aniimo.gg/homeland/object/woodland-level-1/",
        "https://aniimotools.dev/systems/homeland/production-simulator/"
      ],
      "verified": true
    },
    {
      "id": "carousel_mill",
      "name": "Carousel Mill",
      "category": "Processing",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Wind",
          "minLevel": 1
        }
      ],
      "unlockRv": 2,
      "placementLimit": "1 from RV 2, 2 from RV 9",
      "maxByRv": [
        {
          "rv": 2,
          "max": 1
        },
        {
          "rv": 9,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Tenacious",
      "notes": "Aniimo with the Tenacious personality work 20% faster here. Recipes recommend Wind Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/carousel-mill/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/carousel-mill/",
        "https://aniimo.gg/homeland/object/carousel-mill-level-1/"
      ],
      "verified": true
    },
    {
      "id": "dance_pad_polisher",
      "name": "Dance Pad Polisher",
      "category": "Processing",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Lightning",
          "minLevel": 1
        }
      ],
      "unlockRv": 2,
      "placementLimit": "1 from RV 2",
      "maxByRv": [
        {
          "rv": 2,
          "max": 1
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": null,
      "notes": "Recipes recommend Lightning Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/dance-pad-polisher/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/dance-pad-polisher/",
        "https://aniimo.gg/homeland/object/dance-pad-polisher-level-1/"
      ],
      "verified": true
    },
    {
      "id": "mine",
      "name": "Mine",
      "category": "Gathering",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Earth",
          "minLevel": 1
        }
      ],
      "unlockRv": 3,
      "placementLimit": "2 from RV 3, up to 10 from RV 19",
      "maxByRv": [
        {
          "rv": 3,
          "max": 2
        },
        {
          "rv": 5,
          "max": 3
        },
        {
          "rv": 7,
          "max": 4
        },
        {
          "rv": 9,
          "max": 5
        },
        {
          "rv": 11,
          "max": 6
        },
        {
          "rv": 13,
          "max": 7
        },
        {
          "rv": 15,
          "max": 8
        },
        {
          "rv": 17,
          "max": 9
        },
        {
          "rv": 19,
          "max": 10
        }
      ],
      "maxByRvVerified": false,
      "maxByRvNotes": "Intermediate steps come from the RV upgrade requirements (to build RV N+1 the game asks you to place this many at RV N, e.g. \"Place 18 farmlands\" before RV 10). They match both published end points (2 from RV 3, up to 10 from RV 19) but the in-game cap at each level has not been confirmed directly.",
      "maxByRvSource": "https://aniimotools.dev/systems/homeland/rv-levels/",
      "recommendedLevel": "1–3",
      "personalityBonus": "Playful",
      "notes": "Aniimo with the Playful personality work 20% faster here. Recipes recommend Earth Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/mine/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/mine/",
        "https://aniimo.gg/homeland/object/mine-level-1/"
      ],
      "verified": true
    },
    {
      "id": "crafting_table",
      "name": "Crafting Table",
      "category": "Crafting",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Artisanship",
          "minLevel": 1
        }
      ],
      "unlockRv": 3,
      "placementLimit": "1 from RV 3, 2 from RV 10",
      "maxByRv": [
        {
          "rv": 3,
          "max": 1
        },
        {
          "rv": 10,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Judicious",
      "notes": "Aniimo with the Judicious personality work 20% faster here. Recipes recommend Artisanship Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/crafting-table/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/crafting-table/",
        "https://aniimo.gg/homeland/object/crafting-table-level-1/"
      ],
      "verified": true
    },
    {
      "id": "aniipod_maker",
      "name": "Aniipod Maker",
      "category": "Crafting",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Lightning",
          "minLevel": 1
        }
      ],
      "unlockRv": 3,
      "placementLimit": "1 from RV 3",
      "maxByRv": [
        {
          "rv": 3,
          "max": 1
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": null,
      "notes": "Recipes recommend Lightning Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/aniipod-maker/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/aniipod-maker/",
        "https://aniimo.gg/homeland/object/aniipod-maker-level-1/"
      ],
      "verified": true
    },
    {
      "id": "well",
      "name": "Well",
      "category": "Gathering",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Water",
          "minLevel": 1
        }
      ],
      "unlockRv": 4,
      "placementLimit": "1 from RV 4, 2 from RV 8, 3 from RV 14, 4 from RV 19",
      "maxByRv": [
        {
          "rv": 4,
          "max": 1
        },
        {
          "rv": 8,
          "max": 2
        },
        {
          "rv": 14,
          "max": 3
        },
        {
          "rv": 19,
          "max": 4
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Faithful",
      "notes": "Aniimo with the Faithful personality work 20% faster here. Recipes recommend Water Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/well/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/well/",
        "https://aniimo.gg/homeland/object/well-level-1/"
      ],
      "verified": true
    },
    {
      "id": "claw_game_cooker",
      "name": "Claw Game Cooker",
      "category": "Kitchen",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Fire",
          "minLevel": 1
        }
      ],
      "unlockRv": 4,
      "placementLimit": "1 from RV 4, 2 from RV 11",
      "maxByRv": [
        {
          "rv": 4,
          "max": 1
        },
        {
          "rv": 11,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Practical",
      "notes": "Aniimo with the Practical personality work 20% faster here. Recipes recommend Fire Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/claw-game-cooker/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/claw-game-cooker/",
        "https://aniimo.gg/homeland/object/claw-game-cooker-level-1/"
      ],
      "verified": true
    },
    {
      "id": "jukebox_dryer",
      "name": "Jukebox Dryer",
      "category": "Processing",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Dark",
          "minLevel": 1
        }
      ],
      "unlockRv": 4,
      "placementLimit": "1 from RV 4, 2 from RV 11",
      "maxByRv": [
        {
          "rv": 4,
          "max": 1
        },
        {
          "rv": 11,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Nimble",
      "notes": "Aniimo with the Nimble personality work 20% faster here. Recipes recommend Dark Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/jukebox-dryer/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/jukebox-dryer/",
        "https://aniimo.gg/homeland/object/jukebox-dryer-level-1/"
      ],
      "verified": true
    },
    {
      "id": "simmering_pot",
      "name": "Simmering Pot",
      "category": "Kitchen",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Fire",
          "minLevel": 1
        }
      ],
      "unlockRv": 5,
      "placementLimit": "1 from RV 5, 2 from RV 12",
      "maxByRv": [
        {
          "rv": 5,
          "max": 1
        },
        {
          "rv": 12,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Tenacious",
      "notes": "Aniimo with the Tenacious personality work 20% faster here. Recipes recommend Fire Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/simmering-pot/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/simmering-pot/",
        "https://aniimo.gg/homeland/object/simmering-pot-level-1/"
      ],
      "verified": true
    },
    {
      "id": "tidewhisper_sandcastle",
      "name": "Tidewhisper Sandcastle",
      "category": "Leisure",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Leisure",
          "minLevel": 1
        }
      ],
      "unlockRv": 5,
      "placementLimit": "1 from RV 5, 2 from RV 14",
      "maxByRv": [
        {
          "rv": 5,
          "max": 1
        },
        {
          "rv": 14,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": "Judicious",
      "notes": "Aniimo with the Judicious personality work 20% faster here. Recipes recommend Leisure Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/tidewhisper-sandcastle/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/tidewhisper-sandcastle/",
        "https://aniimo.gg/homeland/object/tidewhisper-sandcastle-level-1/"
      ],
      "verified": true
    },
    {
      "id": "bouncy_brew_keg",
      "name": "Bouncy Brew Keg",
      "category": "Kitchen",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Water",
          "minLevel": 1
        }
      ],
      "unlockRv": 6,
      "placementLimit": "1 from RV 6, 2 from RV 13",
      "maxByRv": [
        {
          "rv": 6,
          "max": 1
        },
        {
          "rv": 13,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Energetic",
      "notes": "Aniimo with the Energetic personality work 20% faster here. Recipes recommend Water Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/bouncy-brew-keg/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/bouncy-brew-keg/",
        "https://aniimo.gg/homeland/object/bouncy-brew-keg-level-1/"
      ],
      "verified": true
    },
    {
      "id": "chimney_kiln",
      "name": "Chimney Kiln",
      "category": "Processing",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Fire",
          "minLevel": 1
        }
      ],
      "unlockRv": 6,
      "placementLimit": "1 from RV 6, 2 from RV 10, 3 from RV 14, 4 from RV 18",
      "maxByRv": [
        {
          "rv": 6,
          "max": 1
        },
        {
          "rv": 10,
          "max": 2
        },
        {
          "rv": 14,
          "max": 3
        },
        {
          "rv": 18,
          "max": 4
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Practical",
      "notes": "Aniimo with the Practical personality work 20% faster here. Recipes recommend Fire Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/chimney-kiln/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/chimney-kiln/",
        "https://aniimo.gg/homeland/object/chimney-kiln-level-1/"
      ],
      "verified": true
    },
    {
      "id": "woodworking_bench",
      "name": "Woodworking Bench",
      "category": "Crafting",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Artisanship",
          "minLevel": 1
        }
      ],
      "unlockRv": 6,
      "placementLimit": "1 from RV 6, 2 from RV 10, 3 from RV 14, 4 from RV 18",
      "maxByRv": [
        {
          "rv": 6,
          "max": 1
        },
        {
          "rv": 10,
          "max": 2
        },
        {
          "rv": 14,
          "max": 3
        },
        {
          "rv": 18,
          "max": 4
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Energetic",
      "notes": "Aniimo with the Energetic personality work 20% faster here. Recipes recommend Artisanship Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/woodworking-bench/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/woodworking-bench/",
        "https://aniimo.gg/homeland/object/woodworking-bench-level-1/"
      ],
      "verified": true
    },
    {
      "id": "phonolfactory_table",
      "name": "Phonolfactory Table",
      "category": "Crafting",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Perfumery",
          "minLevel": 1
        }
      ],
      "unlockRv": 6,
      "placementLimit": "1 from RV 6, 2 from RV 13",
      "maxByRv": [
        {
          "rv": 6,
          "max": 1
        },
        {
          "rv": 13,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Instinctive",
      "notes": "Aniimo with the Instinctive personality work 20% faster here. Recipes recommend Perfumery Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/phonolfactory-table/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/phonolfactory-table/",
        "https://aniimo.gg/homeland/object/phonolfactory-table-level-1/"
      ],
      "verified": true
    },
    {
      "id": "dewy_house",
      "name": "Dewy House",
      "category": "Leisure",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Leisure",
          "minLevel": 1
        }
      ],
      "unlockRv": 6,
      "placementLimit": "1 from RV 6, 2 from RV 17",
      "maxByRv": [
        {
          "rv": 6,
          "max": 1
        },
        {
          "rv": 17,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Instinctive",
      "notes": "Aniimo with the Instinctive personality work 20% faster here. Recipes recommend Leisure Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/dewy-house/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/dewy-house/",
        "https://aniimo.gg/homeland/object/dewy-house-level-1/"
      ],
      "verified": true
    },
    {
      "id": "joy_wheel_loom",
      "name": "Joy Wheel Loom",
      "category": "Processing",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Wind",
          "minLevel": 1
        }
      ],
      "unlockRv": 7,
      "placementLimit": "1 from RV 7, 2 from RV 14",
      "maxByRv": [
        {
          "rv": 7,
          "max": 1
        },
        {
          "rv": 14,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Faithful",
      "notes": "Aniimo with the Faithful personality work 20% faster here. Recipes recommend Wind Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/joy-wheel-loom/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/joy-wheel-loom/",
        "https://aniimo.gg/homeland/object/joy-wheel-loom-level-1/"
      ],
      "verified": true
    },
    {
      "id": "heat_furnace",
      "name": "Heat Furnace",
      "category": "Environment",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Fire",
          "minLevel": 1
        }
      ],
      "unlockRv": 7,
      "placementLimit": "1 from RV 7, 2 from RV 12, 3 from RV 17",
      "maxByRv": [
        {
          "rv": 7,
          "max": 1
        },
        {
          "rv": 12,
          "max": 2
        },
        {
          "rv": 17,
          "max": 3
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1 (required)",
      "personalityBonus": null,
      "notes": "Only sets the climate of nearby plots/facilities while a Fire Aniimo works it. Recipes recommend Fire Lv 1 (required); any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/heat-furnace/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/heat-furnace/",
        "https://aniimo.gg/homeland/object/heat-furnace/"
      ],
      "verified": true
    },
    {
      "id": "cooling_unit",
      "name": "Cooling Unit",
      "category": "Environment",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Ice",
          "minLevel": 1
        }
      ],
      "unlockRv": 7,
      "placementLimit": "1 from RV 7, 2 from RV 13, 3 from RV 17",
      "maxByRv": [
        {
          "rv": 7,
          "max": 1
        },
        {
          "rv": 13,
          "max": 2
        },
        {
          "rv": 17,
          "max": 3
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–2 (required)",
      "personalityBonus": null,
      "notes": "Only sets the climate of nearby plots/facilities while a Ice Aniimo works it. AniimoTools lists 'Lv 1–2 required'; stronger cold (−2) may need a level 2 Ice Aniimo (unverified). Recipes recommend Ice Lv 1–2 (required); any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/cooling-unit/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/cooling-unit/",
        "https://aniimo.gg/homeland/object/cooling-unit/"
      ],
      "verified": true
    },
    {
      "id": "blazing_stove",
      "name": "Blazing Stove",
      "category": "Kitchen",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Fire",
          "minLevel": 1
        }
      ],
      "unlockRv": 8,
      "placementLimit": "1 from RV 8, 2 from RV 15",
      "maxByRv": [
        {
          "rv": 8,
          "max": 1
        },
        {
          "rv": 15,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Nimble",
      "notes": "Aniimo with the Nimble personality work 20% faster here. Recipes recommend Fire Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/blazing-stove/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/blazing-stove/",
        "https://aniimo.gg/homeland/object/blazing-stove-level-1/"
      ],
      "verified": true
    },
    {
      "id": "pickling_jar",
      "name": "Pickling Jar",
      "category": "Kitchen",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Dark",
          "minLevel": 1
        }
      ],
      "unlockRv": 8,
      "placementLimit": "1 from RV 8, 2 from RV 15",
      "maxByRv": [
        {
          "rv": 8,
          "max": 1
        },
        {
          "rv": 15,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Playful",
      "notes": "Aniimo with the Playful personality work 20% faster here. Recipes recommend Dark Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/pickling-jar/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/pickling-jar/",
        "https://aniimo.gg/homeland/object/pickling-jar-level-1/"
      ],
      "verified": true
    },
    {
      "id": "sunlamp",
      "name": "Sunlamp",
      "category": "Environment",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Light",
          "minLevel": 1
        }
      ],
      "unlockRv": 9,
      "placementLimit": "1 from RV 9, 2 from RV 13, 3 from RV 19",
      "maxByRv": [
        {
          "rv": 9,
          "max": 1
        },
        {
          "rv": 13,
          "max": 2
        },
        {
          "rv": 19,
          "max": 3
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1 (required)",
      "personalityBonus": null,
      "notes": "Only sets the climate of nearby plots/facilities while a Light Aniimo works it. Recipes recommend Light Lv 1 (required); any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/sunlamp/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/sunlamp/",
        "https://aniimo.gg/homeland/object/sunlamp/"
      ],
      "verified": true
    },
    {
      "id": "nimbus_bed",
      "name": "Nimbus Bed",
      "category": "Leisure",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Leisure",
          "minLevel": 1
        }
      ],
      "unlockRv": 10,
      "placementLimit": "1 from RV 10, 2 from RV 16",
      "maxByRv": [
        {
          "rv": 10,
          "max": 1
        },
        {
          "rv": 16,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "2–3",
      "personalityBonus": "Judicious",
      "notes": "Aniimo with the Judicious personality work 20% faster here. Recipes recommend Leisure Lv 2–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/nimbus-bed/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/nimbus-bed/",
        "https://aniimo.gg/homeland/object/nimbus-bed-level-1/"
      ],
      "verified": true
    },
    {
      "id": "crackle_generator",
      "name": "Crackle Generator",
      "category": "Environment",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Lightning",
          "minLevel": 1
        }
      ],
      "unlockRv": 12,
      "placementLimit": "1 from RV 12, 2 from RV 15, 3 from RV 18 (needs RV Power Module)",
      "maxByRv": [
        {
          "rv": 12,
          "max": 1
        },
        {
          "rv": 15,
          "max": 2
        },
        {
          "rv": 18,
          "max": 3
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "1–3",
      "personalityBonus": null,
      "notes": "Powers the Home's E-mode; unlocked by the RV Power Module. Recipes recommend Lightning Lv 1–3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/crackle-generator/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/crackle-generator/",
        "https://aniimo.gg/homeland/object/crackle-generator-level-1/"
      ],
      "verified": true
    },
    {
      "id": "starfall_hammock",
      "name": "Starfall Hammock",
      "category": "Leisure",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Leisure",
          "minLevel": 1
        }
      ],
      "unlockRv": 12,
      "placementLimit": "1 from RV 12, 2 from RV 18",
      "maxByRv": [
        {
          "rv": 12,
          "max": 1
        },
        {
          "rv": 18,
          "max": 2
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "3",
      "personalityBonus": "Faithful",
      "notes": "Aniimo with the Faithful personality work 20% faster here. Recipes recommend Leisure Lv 3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/starfall-hammock/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/starfall-hammock/",
        "https://aniimo.gg/homeland/object/starfall-hammock/"
      ],
      "verified": true
    },
    {
      "id": "floral_windmill",
      "name": "Floral Windmill",
      "category": "Leisure",
      "behavior": "continuous",
      "countLabel": "facilities",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Leisure",
          "minLevel": 1
        }
      ],
      "unlockRv": 18,
      "placementLimit": "1 from RV 18",
      "maxByRv": [
        {
          "rv": 18,
          "max": 1
        }
      ],
      "maxByRvVerified": true,
      "recommendedLevel": "3",
      "personalityBonus": "Nimble",
      "notes": "Aniimo with the Nimble personality work 20% faster here. Recipes recommend Leisure Lv 3; any level can work, higher is faster.",
      "source": "https://aniimotools.dev/systems/homeland/stations/floral-windmill/",
      "sources": [
        "https://aniimotools.dev/systems/homeland/stations/floral-windmill/",
        "https://aniimo.gg/homeland/object/floral-windmill/"
      ],
      "verified": true
    }
  ],
  "removedBuildings": [
    {
      "id": "storage_hauling",
      "name": "Storage Unit",
      "category": "Logistics",
      "behavior": "continuous",
      "countLabel": "haulers",
      "defaultCount": 0,
      "defaultEnabled": true,
      "slotsPerUnit": 1,
      "requirements": [
        {
          "skill": "Hauling",
          "minLevel": 1
        }
      ],
      "unlockRv": 2,
      "placementLimit": "Player choice",
      "removedReason": "Confirmed in-game by a player: Storage Units are only drop-off points for hauling Aniimo, not staffed buildings. Hauling is covered by the Estimated Require Hauling target and spare-space hauler suggestions.",
      "notes": "Hauling Aniimo carry stockpiled produce from facilities to Storage Units (unlocked at RV 2). Storage Units themselves have no worker slot.",
      "source": "https://aniimo.gg/homeland/work/",
      "sources": [
        "https://aniimo.gg/homeland/work/",
        "https://aniimo.gg/homeland/rv/",
        "https://aniimo.gg/homeland/object/storage-unit/"
      ],
      "verified": true
    }
  ]
};
