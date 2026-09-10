export const POPULATION_VERSION = "ragnakok-realistic-v1";
export const MENU_TARGET = 500;
export const RECIPE_TARGET = 200;

const EVENT_TYPE_IDS = Object.freeze(["wedding", "corporate", "birthday", "church"]);

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

const INGREDIENT_GROUPS = Object.freeze([
  {
    category: "Proteins",
    locationId: "walk-in-cooler",
    entries: [
      ["Chicken", "lb"], ["Chicken Thigh", "lb"], ["Ground Beef", "lb"],
      ["Beef Brisket", "lb"], ["Beef Tenderloin", "lb"], ["Pork Shoulder", "lb"],
      ["Pork Tenderloin", "lb"], ["Bacon", "lb"], ["Smoked Ham", "lb"],
      ["Turkey Breast", "lb"], ["Salmon Fillet", "lb"], ["Whitefish Fillet", "lb"]
    ]
  },
  {
    category: "Seafood and Plant Proteins",
    locationId: "reach-in-freezer",
    entries: [
      ["Shrimp 16/20", "lb"], ["Crab Meat", "lb"], ["Andouille Sausage", "lb"],
      ["Italian Sausage", "lb"], ["Lamb Chop", "lb"], ["Extra-Firm Tofu", "lb"],
      ["Black Beans", "lb"], ["Chickpeas", "lb"], ["Red Beans", "lb"],
      ["Pinto Beans", "lb"], ["White Beans", "lb"], ["Large Eggs", "dozen"]
    ]
  },
  {
    category: "Aromatics",
    locationId: "walk-in-cooler",
    entries: [
      ["Yellow Onion", "lb"], ["Red Onion", "lb"], ["Fresh Garlic", "lb"],
      ["Celery", "lb"], ["Carrot", "lb"], ["Green Bell Pepper", "lb"],
      ["Red Bell Pepper", "lb"], ["Jalapeno", "lb"], ["Poblano Pepper", "lb"],
      ["Scallion", "lb"], ["Leek", "lb"], ["Fresh Ginger", "lb"]
    ]
  },
  {
    category: "Fresh Produce",
    locationId: "walk-in-cooler",
    entries: [
      ["Romaine Lettuce", "lb"], ["Baby Spinach", "lb"], ["Arugula", "lb"],
      ["Kale", "lb"], ["Collard Greens", "lb"], ["Green Cabbage", "lb"],
      ["Broccoli", "lb"], ["Brussels Sprouts", "lb"], ["Green Beans", "lb"],
      ["Sweet Corn", "lb"], ["Cremini Mushroom", "lb"], ["Cauliflower", "lb"]
    ]
  },
  {
    category: "Produce and Fruit",
    locationId: "walk-in-cooler",
    entries: [
      ["Russet Potato", "lb"], ["Sweet Potato", "lb"], ["Roma Tomato", "lb"],
      ["Cherry Tomato", "lb"], ["Cucumber", "lb"], ["Zucchini", "lb"],
      ["Lemon", "each"], ["Lime", "each"], ["Orange", "each"],
      ["Strawberry", "lb"], ["Blueberry", "lb"], ["Peach", "lb"]
    ]
  },
  {
    category: "Dairy",
    locationId: "walk-in-cooler",
    entries: [
      ["Heavy Cream", "qt"], ["Whole Milk", "gal"], ["Unsalted Butter", "lb"],
      ["Sharp Cheddar", "lb"], ["Parmesan", "lb"], ["Mozzarella", "lb"],
      ["Cream Cheese", "lb"], ["Sour Cream", "qt"], ["Feta", "lb"],
      ["Greek Yogurt", "qt"], ["Evaporated Milk", "each"], ["Buttermilk", "gal"]
    ]
  },
  {
    category: "Grains and Pasta",
    locationId: "dry-storage",
    entries: [
      ["Long-Grain Rice", "lb"], ["Jasmine Rice", "lb"], ["Arborio Rice", "lb"],
      ["Fettuccine", "lb"], ["Penne Pasta", "lb"], ["Spaghetti", "lb"],
      ["Elbow Macaroni", "lb"], ["All-Purpose Flour", "lb"], ["Yellow Cornmeal", "lb"],
      ["Panko Breadcrumbs", "lb"], ["Rolled Oats", "lb"], ["Corn Tortillas", "dozen"]
    ]
  },
  {
    category: "Baking and Bread",
    locationId: "dry-storage",
    entries: [
      ["Granulated Sugar", "lb"], ["Brown Sugar", "lb"], ["Powdered Sugar", "lb"],
      ["Active Dry Yeast", "oz"], ["Baking Powder", "oz"], ["Vanilla Extract", "fl_oz"],
      ["Dark Chocolate", "lb"], ["Pecans", "lb"], ["Walnuts", "lb"],
      ["Dinner Rolls", "dozen"], ["French Baguette", "each"], ["Brioche Slider Buns", "dozen"]
    ]
  },
  {
    category: "Herbs and Spices",
    locationId: "dry-storage",
    entries: [
      ["Kosher Salt", "oz"], ["Black Pepper", "oz"], ["Smoked Paprika", "oz"],
      ["Cayenne Pepper", "oz"], ["Garlic Powder", "oz"], ["Onion Powder", "oz"],
      ["Dried Thyme", "oz"], ["Dried Rosemary", "oz"], ["Dried Basil", "oz"],
      ["Dried Oregano", "oz"], ["Fresh Parsley", "lb"], ["Fresh Cilantro", "lb"]
    ]
  },
  {
    category: "Sauces, Stocks, and Beverage Bases",
    locationId: "dry-storage",
    entries: [
      ["Olive Oil", "qt"], ["Vegetable Oil", "qt"], ["Soy Sauce", "qt"],
      ["Worcestershire Sauce", "fl_oz"], ["Louisiana Hot Sauce", "fl_oz"], ["Smoky Barbecue Sauce", "qt"],
      ["Tomato Sauce", "qt"], ["Chicken Stock", "gal"], ["Beef Stock", "gal"],
      ["Vegetable Stock", "gal"], ["Apple Cider Vinegar", "qt"], ["Balsamic Vinegar", "qt"]
    ]
  },
  {
    category: "Condiments and Beverages",
    locationId: "beverage-station",
    entries: [
      ["Wildflower Honey", "lb"], ["Maple Syrup", "qt"], ["Dijon Mustard", "qt"],
      ["Coconut Milk", "each"], ["Coffee Concentrate", "qt"], ["Black Tea Concentrate", "qt"],
      ["Lemonade Concentrate", "gal"], ["Orange Juice", "gal"], ["Cranberry Juice", "gal"],
      ["Sparkling Water", "each"], ["Mayonnaise", "qt"], ["Creole Seasoning", "oz"]
    ]
  }
]);

const SUPPLIERS = Object.freeze(["Supplier A", "Supplier B", "Supplier C"]);
const UNIT_COST_BASE = Object.freeze({ lb: 220, oz: 45, qt: 310, gal: 840, each: 95, dozen: 420 });
const UNIT_OPENING_BASE = Object.freeze({ lb: 24, oz: 48, qt: 8, gal: 6, each: 36, dozen: 8 });

export const REALISTIC_INGREDIENTS = Object.freeze(INGREDIENT_GROUPS.flatMap((group, groupIndex) =>
  group.entries.map(([name, baseUnitId], itemIndex) => {
    const ingredientKey = slugify(name);
    const supplier = name === "Chicken" ? "Supplier B" : SUPPLIERS[(groupIndex + itemIndex) % SUPPLIERS.length];
    return Object.freeze({
      ingredientKey,
      ingredientId: `${POPULATION_VERSION}-${ingredientKey}`,
      name,
      category: group.category,
      baseUnitId,
      stockLocationId: group.locationId,
      openingQuantity: name === "Chicken"
        ? "64"
        : String((UNIT_OPENING_BASE[baseUnitId] || 10) + ((groupIndex * 3 + itemIndex) % 9)),
      costBasisQuantity: "1",
      costTotalMinor: name === "Chicken"
        ? 325
        : (UNIT_COST_BASE[baseUnitId] || 100) + (groupIndex * 19) + (itemIndex * 13),
      currency: "USD",
      supplier
    });
  })));

export const REALISTIC_LOCATIONS = Object.freeze([
  Object.freeze({ locationId: "main-kitchen", name: "Main Production Kitchen" }),
  Object.freeze({ locationId: "walk-in-cooler", name: "Walk-In Cooler" }),
  Object.freeze({ locationId: "reach-in-freezer", name: "Reach-In Freezer" }),
  Object.freeze({ locationId: "dry-storage", name: "Dry Storage" }),
  Object.freeze({ locationId: "beverage-station", name: "Beverage Station" })
]);

const MENU_NAMES_BY_SECTION = Object.freeze({
  appetizers: Object.freeze([
    "Bourbon Peach Meatballs", "Smoked Gouda Arancini", "Creole Shrimp Toasts",
    "Hot Honey Chicken Biscuit Bites", "Roasted Tomato Whipped Feta Crostini", "Charred Corn Crab Cakes",
    "Maple Pepper Pork Belly Skewers", "Garden Herb Stuffed Mushrooms", "Blackberry Brie Phyllo Cups",
    "Cajun Deviled Egg Trio", "Lemon Dill Salmon Cakes", "Sweet Potato Hushpuppy Bites",
    "Brown Sugar Bacon Cornbread Coins"
  ]),
  meats: Object.freeze([
    "Brown Butter Sage Chicken", "Coffee-Rubbed Beef Tenderloin", "Peach Bourbon Pork Tenderloin",
    "Citrus Herb Salmon", "Creole Garlic Shrimp", "Rosemary Dijon Lamb Chops",
    "Smoked Cherry Brisket", "Honey Harissa Chicken Thighs", "Blackened Gulf Whitefish",
    "Maple Mustard Turkey Breast", "Balsamic Mushroom Cauliflower Steak", "Cane Syrup Glazed Ham",
    "Garlic Thyme Sunday Roast"
  ]),
  salads: Object.freeze([
    "Strawberry Basil Garden Salad", "Charred Corn Caesar", "Cucumber Feta Ribbon Salad",
    "Roasted Peach Arugula Salad", "Creole Tomato Wedge Salad", "Lemon Herb Chickpea Salad",
    "Warm Bacon Spinach Salad", "Blueberry Pecan Kale Salad", "Citrus Avocado Romaine",
    "Smoky Sweet Potato Slaw", "Balsamic Mushroom Greens", "Honey Dijon Broccoli Crunch",
    "Peach Pecan Harvest Salad"
  ]),
  pastas: Object.freeze([
    "Blackened Salmon Penne", "Brown Butter Chicken Fettuccine", "Creole Shrimp Macaroni",
    "Roasted Tomato Basil Pasta", "Smoked Gouda Brisket Mac", "Cajun Andouille Penne",
    "Wild Mushroom Parmesan Fettuccine", "Lemon Spinach Cream Pasta", "Peach Pepper Pork Pasta",
    "Garden Vegetable Baked Spaghetti", "Crab Alfredo Celebration Pasta", "Honey Harissa Chicken Penne",
    "Cremini Marsala Fettuccine"
  ]),
  specialty_bars: Object.freeze([
    "Bayou Brisket Biscuit Bar", "Build-Your-Own Creole Bowl", "Garden Harvest Grain Bar",
    "Smoked Chicken Mac Bar", "Coastal Shrimp and Grits Bar", "Sunday Supper Potato Bar",
    "Citrus Salmon Salad Bar", "Southern Slider Social", "Street Corn Taco Bar",
    "Pasta Primavera Action Bar", "Hot Honey Chicken Waffle Bar", "Bourbon Peach Dessert Bar",
    "Lowcountry Supper Bowl Bar"
  ]),
  soups: Object.freeze([
    "Fire-Roasted Tomato Bisque", "Smoked Chicken Corn Chowder", "Creole Shrimp Gumbo",
    "Rosemary Beef and Barley Soup", "Coconut Curry Sweet Potato Soup", "White Bean Kale Ragout",
    "Andouille Red Bean Stew", "Lemon Chicken Orzo Soup", "Roasted Cauliflower Parmesan Soup",
    "Garden Vegetable Pistou", "Bourbon Onion Beef Soup", "Creamy Mushroom Thyme Soup",
    "Smoky Tomato Red Bean Chili"
  ]),
  sides: Object.freeze([
    "Brown Butter Sweet Potato Mash", "Creole Garlic Green Beans", "Smoked Cheddar Grits",
    "Lemon Parsley Rice Pilaf", "Maple Bacon Brussels Sprouts", "Roasted Tomato Jasmine Rice",
    "Honey Harissa Carrots", "Parmesan Herb Potatoes", "Cajun Corn Spoonbread",
    "Balsamic Mushroom Medley", "Slow-Braised Collard Greens", "Peach Glazed Root Vegetables",
    "Charred Poblano Creamed Corn"
  ]),
  desserts: Object.freeze([
    "Bourbon Vanilla Bread Pudding", "Brown Butter Pecan Blondies", "Peach Cobbler Cheesecake Cups",
    "Dark Chocolate Espresso Tart", "Strawberry Buttermilk Shortcake", "Maple Sweet Potato Pie Bars",
    "Blueberry Lemon Cream Trifle", "Banana Foster Pudding Jars", "Honey Cornmeal Tea Cakes",
    "Salted Caramel Apple Cobbler", "Chocolate Pecan Praline Brownies", "Citrus Vanilla Celebration Cake",
    "Brown Sugar Peach Crumble Bars"
  ]),
  beverages: Object.freeze([
    "Blackberry Sage Lemonade", "Peach Basil Sweet Tea", "Cranberry Orange Sparkler",
    "Honey Citrus Arnold Palmer", "Blueberry Mint Lemonade", "Ginger Peach Iced Tea",
    "Strawberry Lime Cooler", "Cajun Coffee Cream Station", "Orange Vanilla Brunch Punch",
    "Sparkling Rosemary Lemon Water", "Brown Sugar Cold Brew", "Citrus Berry Hydration Bar",
    "Honey Ginger Porch Punch"
  ]),
  breads: Object.freeze([
    "Brown Butter Honey Rolls", "Cheddar Scallion Cornbread", "Rosemary Garlic Pull-Apart Bread",
    "Buttermilk Biscuit Basket", "Smoked Gouda Dinner Rolls", "Sweet Potato Cornbread Muffins",
    "Brioche Herb Slider Buns", "Cajun Parmesan Bread Knots", "Maple Pecan Breakfast Bread",
    "Roasted Garlic Baguette", "Honey Buttermilk Yeast Rolls", "Black Pepper Cheddar Biscuits",
    "Rosemary Sea Salt Supper Rolls"
  ])
});

const SECTION_PRICE_MINOR = Object.freeze({
  appetizers: 650, meats: 1450, salads: 725, pastas: 1100, specialty_bars: 1650,
  soups: 725, sides: 550, desserts: 650, beverages: 425, breads: 350
});

export const CREATIVE_MENU_ITEMS = Object.freeze(Object.entries(MENU_NAMES_BY_SECTION)
  .flatMap(([sectionId, names], sectionIndex) => names.map((name, itemIndex) => {
    const eventTypeId = EVENT_TYPE_IDS[(sectionIndex + itemIndex) % EVENT_TYPE_IDS.length];
    const priceMinor = SECTION_PRICE_MINOR[sectionId] + ((itemIndex % 4) * 75);
    return Object.freeze({
      populationKey: slugify(name),
      name,
      eventTypeId,
      categoryId: `${eventTypeId}__${sectionId}`,
      sectionId,
      priceMinor,
      costMinor: Math.round(priceMinor * 0.34),
      pricingType: "per_person",
      active: true
    });
  })));

const INGREDIENT_BY_KEY = new Map(REALISTIC_INGREDIENTS.map((ingredient) => [ingredient.ingredientKey, ingredient]));

function keyFor(name) {
  const key = slugify(name);
  if (!INGREDIENT_BY_KEY.has(key)) throw new Error(`Recipe fixture references unknown ingredient ${name}.`);
  return key;
}

const QUANTITIES = Object.freeze({
  "kosher-salt": "0.08", "black-pepper": "0.04", "olive-oil": "0.02",
  "vegetable-oil": "0.02", "fresh-garlic": "0.015", "yellow-onion": "0.08",
  "fresh-parsley": "0.01", "unsalted-butter": "0.04", "heavy-cream": "0.08",
  parmesan: "0.06", "all-purpose-flour": "0.08", "granulated-sugar": "0.08",
  "chicken-stock": "0.12", "beef-stock": "0.12", "vegetable-stock": "0.12",
  "long-grain-rice": "0.18", "fettuccine": "0.22", "penne-pasta": "0.22",
  spaghetti: "0.22", "elbow-macaroni": "0.22", "romaine-lettuce": "0.18",
  "baby-spinach": "0.16", arugula: "0.14", kale: "0.16", "russet-potato": "0.35",
  "sweet-potato": "0.35", "roma-tomato": "0.12", "green-beans": "0.22",
  "brussels-sprouts": "0.22", "sweet-corn": "0.2", "sharp-cheddar": "0.08",
  "large-eggs": "0.083333", "whole-milk": "0.03", buttermilk: "0.03",
  "brown-sugar": "0.06", "vanilla-extract": "0.04", "dark-chocolate": "0.08",
  pecans: "0.05", strawberry: "0.16", blueberry: "0.14", peach: "0.18",
  lemon: "0.2", lime: "0.2", "black-tea-concentrate": "0.08",
  "lemonade-concentrate": "0.08", "coffee-concentrate": "0.08",
  "cranberry-juice": "0.08", "orange-juice": "0.08", "sparkling-water": "1"
});

function proteinKeyFor(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("shrimp")) return keyFor("Shrimp 16/20");
  if (normalized.includes("crab")) return keyFor("Crab Meat");
  if (normalized.includes("salmon")) return keyFor("Salmon Fillet");
  if (normalized.includes("whitefish") || normalized.includes("fish")) return keyFor("Whitefish Fillet");
  if (normalized.includes("brisket")) return keyFor("Beef Brisket");
  if (normalized.includes("beef") || normalized.includes("steak") || normalized.includes("meatball")) return keyFor("Ground Beef");
  if (normalized.includes("pork")) return keyFor("Pork Tenderloin");
  if (normalized.includes("ham")) return keyFor("Smoked Ham");
  if (normalized.includes("turkey")) return keyFor("Turkey Breast");
  if (normalized.includes("lamb")) return keyFor("Lamb Chop");
  if (normalized.includes("andouille") || normalized.includes("sausage")) return keyFor("Andouille Sausage");
  if (normalized.includes("tofu")) return keyFor("Extra-Firm Tofu");
  if (normalized.includes("bean") || normalized.includes("chickpea")) return keyFor("Chickpeas");
  return keyFor("Chicken");
}

function sectionFromMenuItem(menuItem) {
  const explicit = String(menuItem?.sectionId || "").trim();
  if (explicit) return explicit;
  const categoryId = String(menuItem?.categoryId || "");
  return categoryId.includes("__") ? categoryId.split("__").at(-1) : "meats";
}

function recipeKeysFor(menuItem) {
  const name = String(menuItem?.name || "");
  const normalized = name.toLowerCase();
  const sectionId = sectionFromMenuItem(menuItem);
  if (normalized.includes("chicken alfredo")) {
    return ["Chicken", "Fettuccine", "Heavy Cream", "Parmesan", "Fresh Garlic", "Unsalted Butter"];
  }
  if (sectionId === "meats") {
    return [INGREDIENT_BY_KEY.get(proteinKeyFor(name)).name, "Olive Oil", "Fresh Garlic", "Kosher Salt", "Black Pepper", "Fresh Parsley"];
  }
  if (sectionId === "appetizers") {
    return [INGREDIENT_BY_KEY.get(proteinKeyFor(name)).name, "All-Purpose Flour", "Large Eggs", "Panko Breadcrumbs", "Vegetable Oil", "Fresh Parsley"];
  }
  if (sectionId === "salads") {
    const green = normalized.includes("spinach") ? "Baby Spinach" : normalized.includes("kale") ? "Kale" : normalized.includes("arugula") ? "Arugula" : "Romaine Lettuce";
    const fruit = normalized.includes("blueberry") ? "Blueberry" : normalized.includes("peach") ? "Peach" : "Cherry Tomato";
    return [green, fruit, "Cucumber", "Red Onion", "Olive Oil", "Balsamic Vinegar"];
  }
  if (sectionId === "pastas") {
    const pasta = normalized.includes("fettuccine") ? "Fettuccine" : normalized.includes("spaghetti") ? "Spaghetti" : normalized.includes("mac") ? "Elbow Macaroni" : "Penne Pasta";
    return [pasta, INGREDIENT_BY_KEY.get(proteinKeyFor(name)).name, "Heavy Cream", "Parmesan", "Fresh Garlic", "Unsalted Butter"];
  }
  if (sectionId === "specialty_bars") {
    return [INGREDIENT_BY_KEY.get(proteinKeyFor(name)).name, "Long-Grain Rice", "Sharp Cheddar", "Sour Cream", "Roma Tomato", "Fresh Cilantro"];
  }
  if (sectionId === "soups") {
    const stock = normalized.includes("beef") ? "Beef Stock" : normalized.includes("vegetable") || normalized.includes("cauliflower") ? "Vegetable Stock" : "Chicken Stock";
    return [stock, INGREDIENT_BY_KEY.get(proteinKeyFor(name)).name, "Yellow Onion", "Celery", "Carrot", "Fresh Garlic"];
  }
  if (sectionId === "sides") {
    const base = normalized.includes("potato") ? "Russet Potato" : normalized.includes("rice") ? "Long-Grain Rice" : normalized.includes("bean") ? "Green Beans" : normalized.includes("brussels") ? "Brussels Sprouts" : "Sweet Corn";
    return [base, "Unsalted Butter", "Fresh Garlic", "Kosher Salt", "Black Pepper", "Fresh Parsley"];
  }
  if (sectionId === "desserts") {
    const accent = normalized.includes("blueberry") ? "Blueberry" : normalized.includes("strawberry") ? "Strawberry" : normalized.includes("peach") ? "Peach" : normalized.includes("chocolate") ? "Dark Chocolate" : "Pecans";
    return ["All-Purpose Flour", "Granulated Sugar", "Unsalted Butter", "Large Eggs", "Whole Milk", accent, "Vanilla Extract"];
  }
  if (sectionId === "beverages") {
    const base = normalized.includes("tea") || normalized.includes("palmer") ? "Black Tea Concentrate" : normalized.includes("coffee") || normalized.includes("cold brew") ? "Coffee Concentrate" : normalized.includes("cranberry") ? "Cranberry Juice" : normalized.includes("orange") ? "Orange Juice" : "Lemonade Concentrate";
    return [base, normalized.includes("peach") ? "Peach" : normalized.includes("blueberry") ? "Blueberry" : "Lemon", "Wildflower Honey", "Sparkling Water"];
  }
  return ["All-Purpose Flour", "Active Dry Yeast", "Unsalted Butter", "Whole Milk", "Kosher Salt", "Sharp Cheddar"];
}

function quantityFor(key, sectionId, name) {
  if (key === "chicken" && String(name).toLowerCase().includes("chicken alfredo")) return "0.4";
  const ingredient = INGREDIENT_BY_KEY.get(key);
  if (QUANTITIES[key]) return QUANTITIES[key];
  if (ingredient.category.includes("Protein") || ingredient.category === "Proteins") return "0.35";
  if (ingredient.baseUnitId === "lb") return sectionId === "desserts" ? "0.08" : "0.12";
  if (ingredient.baseUnitId === "oz") return "0.08";
  if (ingredient.baseUnitId === "qt") return "0.03";
  if (ingredient.baseUnitId === "gal") return "0.02";
  if (ingredient.baseUnitId === "dozen") return "0.083333";
  return "1";
}

export function buildRecipeLines(menuItem, ingredientIdByKey = {}) {
  const sectionId = sectionFromMenuItem(menuItem);
  const seen = new Set();
  return recipeKeysFor(menuItem).map(keyFor).filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((key, index) => {
    const ingredient = INGREDIENT_BY_KEY.get(key);
    const ingredientId = String(ingredientIdByKey[key] || ingredient.ingredientId);
    return Object.freeze({
      lineId: `line-${String(index + 1).padStart(2, "0")}-${key}`,
      ingredientId,
      quantity: quantityFor(key, sectionId, menuItem?.name),
      unitKind: "standard",
      quantityBasis: "as_purchased",
      usableYield: null,
      unitId: ingredient.baseUnitId
    });
  });
}

export function populationSummary() {
  return Object.freeze({
    version: POPULATION_VERSION,
    locations: REALISTIC_LOCATIONS.length,
    ingredients: REALISTIC_INGREDIENTS.length,
    creativeMenuItems: CREATIVE_MENU_ITEMS.length,
    recipeTarget: RECIPE_TARGET,
    minimumMenuTarget: MENU_TARGET
  });
}
