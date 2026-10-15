import { describe, expect, test } from "bun:test";

import {
  ADMIN_MODULE_TITLES,
  getAdminModuleTitle,
} from "../lib/admin/admin-module-metadata";
import { ADMIN_CONSOLE_MODULE_IDS } from "../lib/admin/admin-module-routing";
import { ADMIN_SIDEBAR_ITEM_IDS } from "../lib/admin/sidebar-order";

describe("admin module title metadata", () => {
  test("covers every route and all 15 sidebar modules with a non-empty title", () => {
    expect(ADMIN_SIDEBAR_ITEM_IDS).toHaveLength(15);
    expect(Object.keys(ADMIN_MODULE_TITLES).sort()).toEqual(
      [...ADMIN_CONSOLE_MODULE_IDS].sort(),
    );

    for (const moduleId of ADMIN_CONSOLE_MODULE_IDS) {
      expect(getAdminModuleTitle(moduleId).trim()).not.toBe("");
    }
  });

  test("uses the restaurant root title for its legacy refresh-history route", () => {
    expect(getAdminModuleTitle("restaurant-refresh-history")).toBe(
      getAdminModuleTitle("restaurants"),
    );
  });
});
