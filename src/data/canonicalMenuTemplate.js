const RAW_CANONICAL_MENU_TEMPLATE = [
  {
    id: "appetizers",
    name: "Appetizers",
    items: [
      "Cocktail Meatballs",
      "Assorted Sliders",
      "Finger Sandwiches",
      "Fresh Fruit Kabobs",
      "Assorted Meat Kabobs",
      "Shrimp Kabobs",
      "Assorted Meat Croissants",
      "Veggie Croissants",
      "Veggie Sliders",
      "Heavenly Eggs"
    ]
  },
  {
    id: "sides",
    name: "Sides",
    items: [
      "Jambalaya",
      "Mashed Potatoes",
      "Dirty Rice",
      "Creamy Rice Pilaf",
      "Collards",
      "Cabbage",
      "Green Beans",
      "Glazed Carrots",
      "Roasted Brussel Sprouts",
      "Roasted Asparagus",
      "Creole Corn",
      "Veggie Medley",
      "Creamed Spinach",
      "Etouffee",
      "Baked Beans"
    ]
  },
  {
    id: "desserts",
    name: "Desserts",
    items: [
      "Bread Pudding",
      "Banana Pudding",
      "Assorted Cobblers",
      "Assorted Cakes",
      "Assorted Brownies",
      "Assorted Pies"
    ]
  },
  {
    id: "meats",
    name: "Meats",
    items: [
      "Roasted Chicken",
      "Beef/Pork Ribs",
      "Roast Beef",
      "Blackened/Grill Fish",
      "Blackened/Grill Shrimp",
      "Teriyaki Glazed Chicken",
      "Smoked Brisket",
      "Pulled Pork/Chicken",
      "Baked Ham",
      "Smothered Chicken",
      "Smothered Pork Chops",
      "Grilled Steak",
      "Roasted Lamb Chops",
      "Roasted/Fried Turkey",
      "Smothered Turkey Wings",
      "Smothered Beef Tips",
      "Meatloaf"
    ]
  },
  {
    id: "salads",
    name: "Salads",
    items: [
      "Classic Caesar",
      "Chicken Caesar",
      "Garden Salad",
      "Strawberry Fields",
      "Classic Greek",
      "Potato Salad",
      "Chicken Salad",
      "Egg Salad",
      "Coleslaw"
    ]
  },
  {
    id: "beverages",
    name: "Beverages",
    items: [
      "Fruit Punch",
      "Assorted Lemonade",
      "Assorted Teas",
      "Coffee",
      "Assorted Juices",
      "Still/Sparkling Water"
    ]
  },
  {
    id: "pastas",
    name: "Pastas",
    items: [
      "Creole Chicken Pasta",
      "Seafood Pasta",
      "Million Dollar Spaghetti",
      "Veggie Alfredo Pasta",
      "Chicken Alfredo Pasta",
      "Shrimp Alfredo Pasta",
      "Beef Alfredo Pasta",
      "Baked Spaghetti",
      "Mac & Cheese"
    ]
  },
  {
    id: "specialty-bars",
    name: "Specialty Bars",
    items: [
      "Taco Bar",
      "Soup Bar",
      "Pasta Bar",
      "Potato Bar",
      "Salad Bar"
    ]
  },
  {
    id: "soups",
    name: "Soups",
    items: [
      "Veggie Beef",
      "Veggie Chicken",
      "Chicken Noodle",
      "Seafood Gumbo",
      "Chicken & Sausage Gumbo",
      "Creamy Potato",
      "Creamy Tomato",
      "Yakamein",
      "Red Beans",
      "Pinto Beans",
      "White Beans"
    ]
  },
  {
    id: "breads",
    name: "Breads",
    items: [
      "Cornbread Muffins",
      "Hawaiian Rolls",
      "Yeast Rolls",
      "French Bread",
      "Garlic Bread or Knots"
    ]
  }
];

function toText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

export function slugifyCanonicalMenuValue(value, fallback = "item") {
  const raw = toText(value, fallback).toLowerCase();
  const slug = raw
    .replace(/[^\w-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return slug || fallback;
}

function dedupeCanonicalItems(items = []) {
  const seen = new Set();
  const next = [];

  items.forEach((item, index) => {
    const name = toText(item, `Item ${index + 1}`);
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(name);
  });

  return next;
}

export const CANONICAL_MENU_TEMPLATE = RAW_CANONICAL_MENU_TEMPLATE.map((section, index) => ({
  id: slugifyCanonicalMenuValue(section?.id || section?.name, `category-${index + 1}`),
  name: toText(section?.name, `Category ${index + 1}`),
  items: dedupeCanonicalItems(section?.items)
}));

export const CANONICAL_MENU_CATEGORY_COUNT = CANONICAL_MENU_TEMPLATE.length;
export const CANONICAL_MENU_ITEM_COUNT = CANONICAL_MENU_TEMPLATE.reduce(
  (sum, section) => sum + section.items.length,
  0
);

export function buildCanonicalMenuForEventType(eventTypeId) {
  const resolvedEventTypeId = toText(eventTypeId);
  if (!resolvedEventTypeId) {
    return {
      categories: [],
      items: []
    };
  }

  const categories = [];
  const items = [];

  CANONICAL_MENU_TEMPLATE.forEach((section, sectionIndex) => {
    const categoryId = `${resolvedEventTypeId}__${section.id || `category-${sectionIndex + 1}`}`;
    categories.push({
      id: categoryId,
      eventTypeId: resolvedEventTypeId,
      name: section.name
    });

    section.items.forEach((itemName, itemIndex) => {
      const normalizedItemName = toText(itemName, `Item ${itemIndex + 1}`);
      const itemId = `${categoryId}__${slugifyCanonicalMenuValue(normalizedItemName, `item-${itemIndex + 1}`)}`;
      items.push({
        id: itemId,
        eventTypeId: resolvedEventTypeId,
        categoryId,
        name: normalizedItemName,
        pricingType: "per_event",
        type: "per_event",
        price: 0,
        active: true
      });
    });
  });

  return {
    categories,
    items
  };
}
