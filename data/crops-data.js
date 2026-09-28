window.ANIIMO_CROPS_DATA = {
  "schemaVersion": 1,
  "actionDurationSeconds": 6,
  "actionDurationVerified": false,
  "notes": [
    "Crop names, facility levels, grow times (cycleMinutes) and yields are from the shipped game data. Every grow time was checked against both AniimoTools (Farmland/Woodland station pages) and aniimo.gg (Production Recipes) on 2026-09-28 and they agree. 'Quick' entries are the RV Ecological Module recipes: much bigger harvests, and some grow longer than the normal crop (Quick Wheat 20 min vs Wheat 4 min; Quick Potato 40 min vs Potato 11 min). Both sites list most crops at 40 min.",
    "actionDurationSeconds is NOT a published game value. 6 s is an estimate: AniimoTools' production simulator shows a 40-minute crop as '40.1 min a batch' and a 4-minute crop as '4.1 min a batch', i.e. about 6 s of Aniimo work per plot per cycle on top of the grow time.",
    "Field work rate (AniimoTools): an Aniimo at the recommended level (Lv 1 for all crops) clears 60 workload/min, Lv 2: 90, Lv 3: 120, Lv 4: 150; x0.2 when the food bowl is empty.",
    "environment.speedWithout: growth speed multiplier when the needed climate facility is missing (0 = no work at all).",
    "A crop whose grow time can't be confirmed should set cycleVerified: false (or cycleMinutes: null); the app then shows '(time unknown)' and doesn't fill in minutes. optionNote is a short hint shown after the time in the crop list."
  ],
  "sources": [
    {
      "name": "AniimoTools – Farmland",
      "url": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "notes": "Farmland crops, growth times and harvest sizes."
    },
    {
      "name": "AniimoTools – Woodland",
      "url": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "notes": "Woodland trees, growth times and harvest sizes."
    },
    {
      "name": "AniimoTools – Production simulator",
      "url": "https://aniimotools.dev/systems/homeland/production-simulator/",
      "notes": "Used to estimate how long an Aniimo spends on each plot (about 6 seconds)."
    },
    {
      "name": "aniimo.gg – Production recipes",
      "url": "https://aniimo.gg/homeland/recipes/",
      "notes": "A second list of growth times, used to double-check the ones above."
    }
  ],
  "crops": [
    {
      "id": "farmland_wheat",
      "name": "Wheat",
      "facility": "Farmland",
      "facilityLevel": 1,
      "cycleMinutes": 4,
      "actionDurationSeconds": 6,
      "yield": 5,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_moondew_radish",
      "name": "Moondew Radish",
      "facility": "Farmland",
      "facilityLevel": 1,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "environment": null,
      "unlock": "Recipe Note from Home Season quests (seasonal)",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_waxing_moon_pepper",
      "name": "Waxing Moon Pepper",
      "facility": "Farmland",
      "facilityLevel": 1,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "environment": null,
      "unlock": "Recipe Note from Home Season quests (seasonal)",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_captain_spud",
      "name": "Captain Spud",
      "facility": "Farmland",
      "facilityLevel": 1,
      "cycleMinutes": 13,
      "actionDurationSeconds": 6,
      "yield": 5,
      "environment": null,
      "unlock": "Limited-time collaboration recipe",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_potato",
      "name": "Potato",
      "facility": "Farmland",
      "facilityLevel": 2,
      "cycleMinutes": 11,
      "actionDurationSeconds": 6,
      "yield": 2,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_quick_wheat",
      "name": "Quick Wheat",
      "facility": "Farmland",
      "facilityLevel": 2,
      "cycleMinutes": 20,
      "actionDurationSeconds": 6,
      "yield": 42,
      "environment": null,
      "unlock": "RV Ecological Module Lv 1",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "farmland_rice",
      "name": "Rice",
      "facility": "Farmland",
      "facilityLevel": 3,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 18,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_soybean",
      "name": "Soybean",
      "facility": "Farmland",
      "facilityLevel": 3,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 16,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_rose",
      "name": "Rose",
      "facility": "Farmland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "environment": {
        "need": "Cold −1",
        "facility": "Cooling Unit",
        "speedWithout": 0.8
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_cotton",
      "name": "Cotton",
      "facility": "Farmland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 7,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_quick_potato",
      "name": "Quick Potato",
      "facility": "Farmland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 46,
      "environment": null,
      "unlock": "RV Ecological Module Lv 3",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "farmland_strawberry",
      "name": "Strawberry",
      "facility": "Farmland",
      "facilityLevel": 5,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "environment": {
        "need": "Cold −1",
        "facility": "Cooling Unit",
        "speedWithout": 0.8
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_lavender",
      "name": "Lavender",
      "facility": "Farmland",
      "facilityLevel": 5,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 7,
      "environment": {
        "need": "Light",
        "facility": "Sunlamp",
        "speedWithout": 0
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_sugarcane",
      "name": "Sugarcane",
      "facility": "Farmland",
      "facilityLevel": 5,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 6,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_ginseng",
      "name": "Ginseng",
      "facility": "Farmland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 3,
      "environment": {
        "need": "Cold −1",
        "facility": "Cooling Unit",
        "speedWithout": 0.8
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_grapes",
      "name": "Grapes",
      "facility": "Farmland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 9,
      "environment": {
        "need": "Light",
        "facility": "Sunlamp",
        "speedWithout": 0
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_premium_wheat",
      "name": "Premium Wheat",
      "facility": "Farmland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 15,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_quick_rice",
      "name": "Quick Rice",
      "facility": "Farmland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 79,
      "environment": null,
      "unlock": "RV Ecological Module Lv 5",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "farmland_cranberry",
      "name": "Cranberry",
      "facility": "Farmland",
      "facilityLevel": 7,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 7,
      "environment": {
        "need": "Cold −2",
        "facility": "Cooling Unit",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_agave",
      "name": "Agave",
      "facility": "Farmland",
      "facilityLevel": 7,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 6,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true
    },
    {
      "id": "farmland_quick_strawberry",
      "name": "Quick Strawberry",
      "facility": "Farmland",
      "facilityLevel": 7,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 26,
      "environment": {
        "need": "Cold −1",
        "facility": "Cooling Unit",
        "speedWithout": 0.8
      },
      "unlock": "RV Ecological Module Lv 7",
      "source": "https://aniimotools.dev/systems/homeland/stations/farmland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "woodland_willow_wood",
      "name": "Willow Wood",
      "facility": "Woodland",
      "facilityLevel": 1,
      "cycleMinutes": 11,
      "actionDurationSeconds": 6,
      "yield": 5,
      "woodBlocks": 1,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_bamboo",
      "name": "Bamboo",
      "facility": "Woodland",
      "facilityLevel": 2,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 10,
      "woodBlocks": 8,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_lemon",
      "name": "Lemon",
      "facility": "Woodland",
      "facilityLevel": 2,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "woodBlocks": 8,
      "environment": null,
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_cherry_blossom",
      "name": "Cherry Blossom",
      "facility": "Woodland",
      "facilityLevel": 3,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 7,
      "woodBlocks": 21,
      "environment": {
        "need": "Warmth +1",
        "facility": "Heat Furnace",
        "speedWithout": 0.8
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_apple",
      "name": "Apple",
      "facility": "Woodland",
      "facilityLevel": 3,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "woodBlocks": 21,
      "environment": {
        "need": "Cold −1",
        "facility": "Cooling Unit",
        "speedWithout": 0.8
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_maple_syrup",
      "name": "Maple Syrup",
      "facility": "Woodland",
      "facilityLevel": 3,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 9,
      "woodBlocks": 21,
      "environment": {
        "need": "Cold −2",
        "facility": "Cooling Unit",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_quick_bamboo",
      "name": "Quick Bamboo",
      "facility": "Woodland",
      "facilityLevel": 3,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 23,
      "woodBlocks": 21,
      "environment": null,
      "unlock": "RV Ecological Module Lv 2",
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "woodland_palm_bark",
      "name": "Palm Bark",
      "facility": "Woodland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 6,
      "woodBlocks": 47,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_chestnut",
      "name": "Chestnut",
      "facility": "Woodland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 7,
      "woodBlocks": 47,
      "environment": {
        "need": "Warmth +1",
        "facility": "Heat Furnace",
        "speedWithout": 0.8
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_walnut",
      "name": "Walnut",
      "facility": "Woodland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 6,
      "woodBlocks": 47,
      "environment": {
        "need": "Light",
        "facility": "Sunlamp",
        "speedWithout": 0
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_quick_lemon",
      "name": "Quick Lemon",
      "facility": "Woodland",
      "facilityLevel": 4,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 42,
      "woodBlocks": 47,
      "environment": null,
      "unlock": "RV Ecological Module Lv 4",
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "woodland_natural_rubber",
      "name": "Natural Rubber",
      "facility": "Woodland",
      "facilityLevel": 5,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 3,
      "woodBlocks": 75,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_coconut",
      "name": "Coconut",
      "facility": "Woodland",
      "facilityLevel": 5,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 5,
      "woodBlocks": 75,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_quick_maple_syrup",
      "name": "Quick Maple Syrup",
      "facility": "Woodland",
      "facilityLevel": 5,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 30,
      "woodBlocks": 75,
      "environment": {
        "need": "Cold −2",
        "facility": "Cooling Unit",
        "speedWithout": 0.5
      },
      "unlock": "RV Ecological Module Lv 6",
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    },
    {
      "id": "woodland_cocoa",
      "name": "Cocoa",
      "facility": "Woodland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 6,
      "woodBlocks": 122,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_orange_flower",
      "name": "Orange Flower",
      "facility": "Woodland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "woodBlocks": 122,
      "environment": {
        "need": "Light",
        "facility": "Sunlamp",
        "speedWithout": 0
      },
      "unlock": null,
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true
    },
    {
      "id": "woodland_quick_coconut",
      "name": "Quick Coconut",
      "facility": "Woodland",
      "facilityLevel": 6,
      "cycleMinutes": 40,
      "actionDurationSeconds": 6,
      "yield": 8,
      "woodBlocks": 122,
      "environment": {
        "need": "Warmth +2",
        "facility": "Heat Furnace",
        "speedWithout": 0.5
      },
      "unlock": "RV Ecological Module Lv 8",
      "source": "https://aniimotools.dev/systems/homeland/stations/woodland/",
      "cycleVerified": true,
      "optionNote": "bigger harvest"
    }
  ]
};
