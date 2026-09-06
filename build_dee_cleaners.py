#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_dee_cleaners.py — Dee Cleaners Business Management System
===============================================================
Generates:  Dee_Cleaners_Management.xlsx

This workbook is the SINGLE SOURCE OF TRUTH for the Dee Cleaners business.
It is uploaded to Google Drive and opened with Google Sheets. The web
application (webapp/) and the Apps Script backend (webapp/backend/Code.gs)
read and write this workbook through the Apps Script JSON API.

Data contract (kept identical in Code.gs, mock-server.js and the web app):

  Orders sheet columns (headers on row 3, data rows 4..2003):
    A  Order ID              (formula DC-0001...   — app overwrites on create)
    B  Date                  (ISO string YYYY-MM-DD)
    C  Customer Name
    D  Phone
    E  Email
    F  Service               (summary label, e.g. "Multiple Services")
    G  Description
    H  Quantity
    I  Unit Price
    J  Discount
    K  Total                 (FORMULA — never write through API)
    L  Amount Paid
    M  Balance               (FORMULA — never write through API)
    N  Payment Status        (FORMULA — never write through API)
    O  Order Status
    P  Transport Fee         (paid by the customer — "Transport fees ni juu ya mteja")
    Q  Direct Expense
    R  Net Service Profit    (FORMULA — never write through API)
    S  Notes
    T  Line Items JSON       (full list for multiple-service orders)
    U  Unique Customer Helper (FORMULA — never write through API)

Formulas:
    K: =IF(B="","",MAX(0,I*H-J))                     Total
    M: =IF(B="","",MAX(0,K-L))                       Balance
    N: =IF(B="","",IF(L>=K,"Paid",IF(L>0,"Partial","Unpaid")))
    R: =IF(B="","",K+P-Q)                            Net Service Profit
    A: =IF(B="","",TEXT(ROW()-3,'DC-0000'))           Order ID
    U: =IF(B="","",TRIM(LOWER(C)&"|"&LOWER(D)))      customer helper

Catalog data used here is taken from the supplied
"DEE CLEANERS CATALOG SERVICES.pdf" and "HOUSEHELP CLIENT FORM.pdf".
Nothing is invented beyond those documents.

Requires: openpyxl  (pip install openpyxl)
Run:       python3 build_dee_cleaners.py
"""

import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "Dee_Cleaners_Management.xlsx")

# --------------------------------------------------------------------------
# Brand (colours taken from the supplied Dee Cleaners logo)
# --------------------------------------------------------------------------
NAVY = "213668"        # primary brand navy
SKY = "2D9ED6"         # accent sky blue
MIDBLUE = "2E69A2"
LIGHT = "EAF3FA"       # light blue background
GRAY = "F2F2F2"        # formula columns (do not touch)
WHITE = "FFFFFF"

F_HDR = Font(name="Calibri", size=11, bold=True, color=WHITE)
F_BODY = Font(name="Calibri", size=11, color="1A1A1A")
F_TITLE = Font(name="Calibri", size=14, bold=True, color=NAVY)
F_SECTION = Font(name="Calibri", size=12, bold=True, color=WHITE)
F_NOTE = Font(name="Calibri", size=10, italic=True, color="555555")

FILL_HDR = PatternFill("solid", fgColor=NAVY)
FILL_SECTION = PatternFill("solid", fgColor=MIDBLUE)
FILL_FORMULA = PatternFill("solid", fgColor=GRAY)
FILL_ALT = PatternFill("solid", fgColor=LIGHT)
FILL_KEY = PatternFill("solid", fgColor=LIGHT)

THIN = Side(style="thin", color="C9D4E4")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

CENTER = Alignment(horizontal="center", vertical="center")
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=False)

MONEY = "#,##0"
DATE_FMT = "@"          # dates are stored as ISO strings (YYYY-MM-DD)

# --------------------------------------------------------------------------
# Seeded settings (business information from the supplied catalog, page 6)
# --------------------------------------------------------------------------
SETTINGS_INFO = [
    ("Business Name", "Dee Cleaners"),
    ("Phone 1", "+255 693 806 051"),
    ("Phone 2", "+255 762 292 439"),
    ("Email", "deecleanerscleaningservices@gmail.com"),
    ("Address", "Magomeni, Mikumi"),
    ("Website", ""),
    ("Social Media", ""),
    ("Currency", "TZS"),
    ("Default Transport Policy", "Customer pays transport fees (Transport fees ni juu ya mteja)"),
    ("Room Pricing Note", "Bei zinapungua au Kuongezeka kulingana na ukubwa wa chumba (prices may decrease or increase depending on room size)"),
    ("Live-in Working Hours", "5:00 a.m. - 6:30 p.m."),
    ("Minimum Work Duration (months)", 3),
    ("Agency Fee Note", "One-time agency fee paid by the employer upon contract initiation"),
    ("Payment Policy Note", "All househelp service payments are made directly to Dee Cleaners, which handles salary disbursement"),
    ("Logo Reference", "assets/dee_cleaners_logo/dee_cleaners_logo.png"),
]

# --------------------------------------------------------------------------
# Seeded service lists (from the supplied catalog — pages 1-5)
# --------------------------------------------------------------------------
CLEANING_SERVICES = [
    # name, min, max, category, active, description
    ("Toilet Cleaning", 30000, 40000, "Cleaning", "Yes", ""),
    ("Kitchen Cleaning", 50000, 150000, "Cleaning", "Yes", ""),
    ("Chumba Kimoja (One Room)", 50000, 50000, "Cleaning", "Yes", ""),
    ("Window Cleaning", 15000, 20000, "Cleaning", "Yes", ""),
    ("Sitting Room & 2 Bedrooms", 150000, 150000, "Empty Rooms", "Yes", ""),
    ("Sitting Room & 3 Bedrooms", 200000, 200000, "Empty Rooms", "Yes", ""),
    ("Sitting Room & 4 Bedrooms", 250000, 250000, "Empty Rooms", "Yes", ""),
    ("Sitting Room & 5 Bedrooms", 350000, 350000, "Empty Rooms", "Yes", ""),
    ("Sitting Room & 6 Bedrooms", 450000, 450000, "Empty Rooms", "Yes", ""),
    ("Sitting Room & 2 Bedrooms", 200000, 200000, "Rooms With Furniture Cleaning", "Yes", ""),
    ("Sitting Room & 3 Bedrooms", 250000, 250000, "Rooms With Furniture Cleaning", "Yes", ""),
    ("Sitting Room & 4 Bedrooms", 300000, 300000, "Rooms With Furniture Cleaning", "Yes", ""),
    ("Sitting Room & 5 Bedrooms", 350000, 350000, "Rooms With Furniture Cleaning", "Yes", ""),
    ("Sitting Room & 6 Bedrooms", 450000, 450000, "Rooms With Furniture Cleaning", "Yes", ""),
]

SOFA_SERVICES = [
    (f"{word} Seater Sofa Set", 15000 * n, 15000 * n, "Yes")
    for n, word in enumerate(
        ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
         "Nine", "Ten"], start=1)
]

# name, unit, light, heavy, ironing, active, description
LAUNDRY_SERVICES = [
    ("Ties", "Piece", 1000, "", "", "Yes",
     "1-4 pieces: 1,000 | 5-9 pieces: 900 | 10+ pieces: 800 (per piece)"),
    ("Socks", "Pair", 500, "", "", "Yes",
     "1-4 pairs: 500 | 5-9 pairs: 400 | 10+ pairs: 300 (per pair)"),
    ("Jeans / Cargo / Formal Trousers", "Piece", 500, 1000, "", "Yes",
     "Light: 500 | Heavy: 1,000"),
    ("Bazee / Kikoi / Lace / Kitenge", "Piece", 2000, 3000, "", "Yes",
     "Light: 2,000 | Heavy: 3,000"),
    ("Curtains", "Piece", 5000, "", "", "Yes",
     "5,000 per curtain"),
    ("Bundle of Clothes", "Bundle", 20000, 30000, "", "Yes",
     "30-clothes bundle: Light 20,000 | Heavy 30,000"),
    ("Graduation Gown", "Piece", "", "", 10000, "Yes",
     "+ Ironing: 10,000"),
    ("Wedding Gown", "Piece", "", "", 29900, "Yes",
     "+ Ironing: 29,900"),
    ("Blanket", "Piece", 15000, 29900, "", "Yes",
     "Light: 15,000 | Heavy: 29,900"),
    ("Ironing", "Piece", "", "", "", "Yes",
     "Price set by the administrator"),
]

SPECIALIZED_SERVICES = [
    # name, min, max, active, description
    ("Shoe Cleaning", 2000, 2000, "Yes", ""),
    ("Sewer Cleaning", 20000, 20000, "Yes", ""),
    ("Carpet Cleaning", 15000, 30000, "Yes", ""),
    ("Fumigation Service", 10000, 500000, "Yes", ""),
    ("Gardening & Maintenance", 100000, 1000000, "Yes", ""),
]

HOUSEHELP_CATEGORIES = [
    # name, min, max, active, description
    ("Single Parent Family", 80000, 100000, "Yes", "Family with only one parent"),
    ("Nuclear Family", 150000, 200000, "Yes", "Family with both parents"),
    ("Extended Family", 250000, 500000, "Yes", ""),
    ("Family Including Relative", 250000, 500000, "Yes", ""),
]

SIMPLE_LISTS = {
    "Order Statuses": ["Pending", "Confirmed", "In Progress", "Completed", "Cancelled"],
    "Payment Statuses": ["Paid", "Partial", "Unpaid"],
    "Expense Categories": ["Transport", "Cleaning Materials", "Laundry Materials",
                           "Equipment", "Fuel", "Utilities", "Salaries",
                           "Househelp Payments", "Marketing", "Maintenance", "Other"],
    "Househelp Statuses": ["Available", "Placed", "On Contract", "Inactive",
                           "Replacement Required"],
    "Contract Statuses": ["Pending", "Active", "Completed", "Terminated"],
    "Placement Statuses": ["Pending", "Matching", "Contract Pending", "Active",
                           "Completed", "Terminated", "Replacement Required"],
    "Complaint Statuses": ["Reported", "Under Review", "Mediation", "Resolved",
                           "Escalated"],
    "Complaint Types": ["Salary/payment", "Mistreatment", "Abuse",
                        "Working conditions", "Accommodation", "Food",
                        "Misconduct", "Property/damage", "Other"],
    "Employee/Worker Types": ["Staff", "Worker", "Househelp"],
    "Severity Levels": ["Low", "Medium", "High"],
    "Payment Frequencies": ["Monthly", "Weekly"],
    "Attendance Statuses": ["Present", "Absent", "Half Day", "Leave"],
}

PAYMENT_METHODS = [
    # name, details (account/name left blank — never invented)
    ("Cash", ""),
    ("M-Pesa", ""),
    ("Tigo Pesa", ""),
    ("Airtel Money", ""),
    ("Bank Transfer", ""),
]

# --------------------------------------------------------------------------
# Data-sheet headers (row 3) — the API writes ONLY input columns;
# formula columns (marked *) are never written by the API.
# --------------------------------------------------------------------------
ORDERS_HEADERS = [
    "Order ID", "Date", "Customer Name", "Phone", "Email", "Service",
    "Description", "Quantity", "Unit Price", "Discount", "Total*",
    "Amount Paid", "Balance*", "Payment Status*", "Order Status",
    "Transport Fee", "Direct Expense", "Net Service Profit*", "Notes",
    "Line Items JSON", "Unique Customer Helper*",
]
ORDERS_FORMULA_COLS = {"A", "K", "M", "N", "R", "U"}
ORDERS_N_ROWS = 2000          # data rows 4 .. 2003

CUSTOMERS_HEADERS = [
    "Customer Name", "Phone", "Email", "Number of Orders", "Total Spending",
    "Total Paid", "Outstanding Balance", "Last Service Date", "Customer Status",
]

EXPENSES_HEADERS = [
    "Expense ID", "Date", "Category", "Description", "Amount",
    "Payment Method", "Related Service", "Notes",
]

PAYMENTS_HEADERS = [
    "Payment ID", "Date", "Customer", "Order ID", "Amount",
    "Payment Method", "Reference", "Received By", "Notes",
]

HOUSEHELPS_HEADERS = [
    "Househelp ID", "Full Name", "Phone", "Email", "Gender", "Nationality",
    "Occupation", "NIDA Number", "City/Country", "Home Address",
    "Registration Date", "Status", "Skills", "Experience", "Availability",
    "Notes",
]

EMPLOYERS_HEADERS = [
    "Client ID", "Full Name", "Family Member/Relative", "Phone", "Email",
    "Gender", "Nationality", "Occupation", "City/Country", "NIDA Number",
    "Home Address", "Registration Date", "Notes",
]

PLACEMENTS_HEADERS = [
    "Placement ID", "Househelp ID", "Employer ID", "Category", "Job Description",
    "Salary", "Payment Frequency", "Start Date", "Expected End Date", "Status",
    "Contract Status", "Live-in/Live-out", "Working Hours", "Accommodation",
    "Meals", "Agency Fee", "Notes",
]

HOUSEHELP_PAYMENTS_HEADERS = [
    "Payment ID", "Househelp ID", "Employer ID", "Placement ID", "Payment Date",
    "Period", "Amount", "Payment Method", "Status", "Reference", "Notes",
]

CONTRACTS_HEADERS = [
    "Contract ID", "Placement ID", "Employer", "Househelp", "Start Date",
    "End Date", "Minimum Duration", "Notice Required", "Contract Status",
    "Termination Date", "Termination Reason", "Document Link",
    "Employer Signature", "Househelp Signature", "Dee Cleaners Acknowledged",
    "Notes",
]

COMPLAINTS_HEADERS = [
    "Complaint ID", "Date", "Client", "Househelp", "Placement",
    "Complaint Type", "Description", "Reported By", "Severity", "Status",
    "Dee Cleaners Action", "Resolution", "Resolution Date", "Notes",
]

REPLACEMENTS_HEADERS = [
    "Replacement ID", "Original Placement", "Original Househelp", "Employer",
    "Reason", "Request Date", "Replacement Househelp", "Replacement Date",
    "Status", "Notes",
]

ATTENDANCE_HEADERS = [
    "Attendance ID", "Date", "Person Type", "Person", "Check In", "Check Out",
    "Hours", "Status", "Notes",
]

# --------------------------------------------------------------------------
# Dashboard KPI rows: (label, formula)  — computed live from the data sheets
# --------------------------------------------------------------------------
DASHBOARD_KPIS = [
    ("Today's Sales", "=SUMIFS(Orders!$L$4:$L$2003,Orders!$B$4:$B$2003,TODAY())"),
    ("Today's Orders", "=COUNTIF(Orders!$B$4:$B$2003,TODAY())"),
    ("Today's Expenses", "=SUMIFS(Expenses!$E$4:$E$2003,Expenses!$B$4:$B$2003,TODAY())"),
    ("Today's Profit", "=B4-B6"),
    ("Weekly Revenue", '=SUMIFS(Orders!$L$4:$L$2003,Orders!$B$4:$B$2003,">="&(TODAY()-6))'),
    ("Monthly Revenue", '=SUMIFS(Orders!$L$4:$L$2003,Orders!$B$4:$B$2003,">="&(EOMONTH(TODAY(),-1)+1))'),
    ("Outstanding Customer Payments", "=SUM(Orders!$M$4:$M$2003)"),
    ("Number of Active Customers", '=COUNTIF(Customers!$I$4:$I$1000,"Active")'),
    ("Active Househelps", '=COUNTIF(Househelps!$L$4:$L$500,"Placed")+COUNTIF(Househelps!$L$4:$L$500,"On Contract")'),
    ("Active Placements", '=COUNTIF(Placements!$J$4:$J$500,"Active")'),
    ("Pending Househelp Payments", '=COUNTIF(\'Househelp Payments\'!$I$4:$I$500,"Pending")'),
    ("Active Contracts", '=COUNTIF(Contracts!$I$4:$I$500,"Active")'),
    ("Contracts Expiring Soon", '=COUNTIFS(Contracts!$F$4:$F$500,">="&TODAY(),Contracts!$F$4:$F$500,"<="&(TODAY()+30),Contracts!$I$4:$I$500,"Active")'),
    ("Open Complaints", '=COUNTIF(Complaints!$J$4:$J$500,"Reported")+COUNTIF(Complaints!$J$4:$J$500,"Under Review")+COUNTIF(Complaints!$J$4:$J$500,"Mediation")'),
    ("Replacement Requests", '=COUNTIF(Replacements!$I$4:$I$500,"Requested")+COUNTIF(Replacements!$I$4:$I$500,"In Progress")'),
]

DATA_SHEETS = [
    ("Customers", CUSTOMERS_HEADERS, 1000),
    ("Expenses", EXPENSES_HEADERS, 2000),
    ("Payments", PAYMENTS_HEADERS, 2000),
    ("Househelps", HOUSEHELPS_HEADERS, 500),
    ("Employers", EMPLOYERS_HEADERS, 500),
    ("Placements", PLACEMENTS_HEADERS, 500),
    ("Househelp Payments", HOUSEHELP_PAYMENTS_HEADERS, 500),
    ("Contracts", CONTRACTS_HEADERS, 500),
    ("Complaints", COMPLAINTS_HEADERS, 500),
    ("Replacements", REPLACEMENTS_HEADERS, 500),
    ("Attendance", ATTENDANCE_HEADERS, 500),
]


def style_header_row(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = F_HDR
        cell.fill = FILL_HDR
        cell.alignment = CENTER
        cell.border = BORDER


def build_settings(wb):
    """Settings sheet: business info + all configurable reference lists."""
    ws = wb.active
    ws.title = "Settings"
    ws.sheet_properties.tabColor = NAVY
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 66
    ws.column_dimensions["C"].width = 22
    ws.column_dimensions["D"].width = 22
    ws.column_dimensions["E"].width = 22
    ws.column_dimensions["F"].width = 12
    ws.column_dimensions["G"].width = 60

    ws["A1"] = "DEE CLEANERS — SETTINGS"
    ws["A1"].font = F_TITLE
    ws["A2"] = ("Edit values below, or manage them from the app:  "
                "Services / Settings pages.")
    ws["A2"].font = F_NOTE

    r = 4
    ws.cell(row=3, column=1, value="Setting").font = F_HDR
    ws.cell(row=3, column=1).fill = FILL_HDR
    ws.cell(row=3, column=2, value="Value").font = F_HDR
    ws.cell(row=3, column=2).fill = FILL_HDR
    ws.cell(row=3, column=1).border = BORDER
    ws.cell(row=3, column=2).border = BORDER

    named = {}
    for key, value in SETTINGS_INFO:
        ws.cell(row=r, column=1, value=key).font = F_BODY
        ws.cell(row=r, column=1).fill = FILL_KEY
        ws.cell(row=r, column=1).border = BORDER
        ws.cell(row=r, column=2, value=value).font = F_BODY
        ws.cell(row=r, column=2).border = BORDER
        if key == "Business Name":
            named["BusinessName"] = f"'Settings'!$B${r}"
        if key == "Currency":
            named["Currency"] = f"'Settings'!$B${r}"
        r += 1
    r += 1

    def list_block(title, headers, rows):
        """Write one list block; return (name_col_range, first_row, last_row)."""
        nonlocal r
        ws.cell(row=r, column=1, value=title).font = F_SECTION
        for c in range(1, len(headers) + 1):
            ws.cell(row=r, column=c).fill = FILL_SECTION
        r += 1
        hdr_row = r
        for i, h in enumerate(headers, start=1):
            cell = ws.cell(row=r, column=i, value=h)
            cell.font = F_HDR
            cell.fill = FILL_HDR
            cell.border = BORDER
        r += 1
        first = r
        for row in rows:
            for i, v in enumerate(row, start=1):
                cell = ws.cell(row=r, column=i, value=v)
                cell.font = F_BODY
                cell.border = BORDER
                if i > 1:
                    cell.number_format = MONEY if isinstance(v, (int, float)) else "@"
            r += 1
        last = r - 1
        name_range = f"'Settings'!$A${first}:$A${last}"
        return name_range, hdr_row, last

    # -- Cleaning services
    name_rng, _, _ = list_block(
        "CLEANING SERVICES",
        ["Name", "Min Price", "Max Price", "Category", "Active", "Description"],
        [(n, mn, mx, cat, act, desc) for n, mn, mx, cat, act, desc in CLEANING_SERVICES])
    named["ServiceList"] = name_rng
    r += 1

    name_rng, _, _ = list_block(
        "SOFA SERVICES",
        ["Name", "Min Price", "Max Price", "Active"],
        SOFA_SERVICES)
    named["SofaServiceList"] = name_rng
    r += 1

    name_rng, _, _ = list_block(
        "LAUNDRY SERVICES",
        ["Name", "Unit", "Light Price", "Heavy Price", "Ironing Price",
         "Active", "Description"],
        LAUNDRY_SERVICES)
    named["LaundryServiceList"] = name_rng
    r += 1

    name_rng, _, _ = list_block(
        "SPECIALIZED SERVICES",
        ["Name", "Min Price", "Max Price", "Active", "Description"],
        SPECIALIZED_SERVICES)
    named["SpecializedServiceList"] = name_rng
    r += 1

    name_rng, _, _ = list_block(
        "HOUSEHELP CATEGORIES",
        ["Name", "Min Price", "Max Price", "Active", "Description"],
        HOUSEHELP_CATEGORIES)
    named["HousehelpCategoryList"] = name_rng
    r += 1

    name_rng, _, _ = list_block(
        "PAYMENT METHODS",
        ["Name", "Details"],
        PAYMENT_METHODS)
    named["PaymentMethods"] = name_rng
    r += 1

    for title, items in SIMPLE_LISTS.items():
        name_rng, _, _ = list_block(title.upper(), ["Name"], [(x,) for x in items])
        key = title.replace(" ", "").replace("/", "")
        named[key] = name_rng
        r += 1

    for name, ref in named.items():
        wb.defined_names.add(DefinedName(name, attr_text=ref))
    return ws


def build_orders(wb):
    """Orders sheet: 2,000 data rows with live formulas (K, M, N, R, A, U)."""
    ws = wb.create_sheet("Orders")
    ws.sheet_properties.tabColor = MIDBLUE
    widths = [12, 12, 24, 16, 26, 26, 28, 10, 13, 12, 13, 13, 13, 14, 14,
              13, 13, 15, 30, 40, 30]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w

    ws["A1"] = "DEE CLEANERS — ORDERS"
    ws["A1"].font = F_TITLE
    ws["A2"] = ("Grey columns are formulas — do not edit them. "
                "Fill white columns or use the app. Transport fee is paid by "
                "the customer.")
    ws["A2"].font = F_NOTE

    for i, h in enumerate(ORDERS_HEADERS, start=1):
        cell = ws.cell(row=3, column=i, value=h)
        cell.font = F_HDR
        cell.fill = FILL_HDR
        cell.alignment = CENTER
        cell.border = BORDER
    ws.freeze_panes = "A4"

    first, last = 4, 4 + ORDERS_N_ROWS - 1
    for r in range(first, last + 1):
        # formula columns first (grey)
        for col in ("A", "K", "M", "N", "R", "U"):
            cell = ws[f"{col}{r}"]
            cell.fill = FILL_FORMULA
            cell.border = BORDER
        ws[f"A{r}"] = f'=IF(B{r}="","",TEXT(ROW()-3,"""DC-""0000"))'
        ws[f"K{r}"] = (f'=IF(B{r}="","",MAX(0,IFERROR(I{r},0)*IFERROR(H{r},0)'
                       f'-IFERROR(J{r},0)))')
        ws[f"M{r}"] = f'=IF(B{r}="","",MAX(0,K{r}-L{r}))'
        ws[f"N{r}"] = (f'=IF(B{r}="","",IF(L{r}>=K{r},"Paid",'
                       f'IF(L{r}>0,"Partial","Unpaid")))')
        ws[f"R{r}"] = (f'=IF(B{r}="","",IFERROR(K{r},0)+IFERROR(P{r},0)'
                       f'-IFERROR(Q{r},0))')
        ws[f"U{r}"] = f'=IF(B{r}="","",TRIM(LOWER(C{r})&"|"&LOWER(D{r})))'
        # input columns
        for col in ("B", "C", "D", "E", "F", "G", "H", "I", "J", "L", "O",
                    "P", "Q", "S", "T"):
            cell = ws[f"{col}{r}"]
            cell.font = F_BODY
            cell.border = BORDER
            if col in ("H", "I", "J", "L", "P", "Q"):
                cell.number_format = MONEY
        ws[f"O{r}"].font = F_BODY

    # data validation: order status from the named list
    dv = DataValidation(type="list", formula1="=OrderStatuses", allow_blank=True)
    dv.add(f"O{first}:O{last}")
    ws.add_data_validation(dv)
    return ws


def build_data_sheet(wb, name, headers, n_rows, tab_color):
    ws = wb.create_sheet(name)
    ws.sheet_properties.tabColor = tab_color
    ws["A1"] = f"DEE CLEANERS — {name.upper()}"
    ws["A1"].font = F_TITLE
    ws["A2"] = "Use the app to add and edit records. IDs are assigned automatically."
    ws["A2"].font = F_NOTE
    for i, h in enumerate(headers, start=1):
        cell = ws.cell(row=3, column=i, value=h)
        cell.font = F_HDR
        cell.fill = FILL_HDR
        cell.alignment = CENTER
        cell.border = BORDER
    ws.freeze_panes = "A4"
    for i in range(1, len(headers) + 1):
        letter = get_column_letter(i)
        width = 14 if i > 3 else 16
        if headers[i - 1] in ("Description", "Job Description", "Notes",
                              "Home Address", "Skills", "Experience",
                              "Resolution", "Reason", "Document Link",
                              "Dee Cleaners Action"):
            width = 34
        ws.column_dimensions[letter].width = width
    for r in range(4, 4 + n_rows):
        for i in range(1, len(headers) + 1):
            cell = ws.cell(row=r, column=i)
            cell.font = F_BODY
            cell.border = BORDER
            if headers[i - 1] in ("Amount", "Salary", "Agency Fee"):
                cell.number_format = MONEY
    return ws


def build_dashboard(wb):
    ws = wb.create_sheet("Dashboard")
    ws.sheet_properties.tabColor = SKY
    ws.column_dimensions["A"].width = 40
    ws.column_dimensions["B"].width = 24
    ws["A1"] = "DEE CLEANERS — DASHBOARD"
    ws["A1"].font = F_TITLE
    ws["A2"] = ("KPIs are calculated live from the data sheets. "
                "Open the web application for the full dashboard with charts.")
    ws["A2"].font = F_NOTE
    style_header_row(ws, 3, 2)
    ws.cell(row=3, column=1, value="KPI").font = F_HDR
    ws.cell(row=3, column=1).fill = FILL_HDR
    ws.cell(row=3, column=1).border = BORDER
    ws.cell(row=3, column=2, value="Value").font = F_HDR
    ws.cell(row=3, column=2).fill = FILL_HDR
    ws.cell(row=3, column=2).border = BORDER
    for i, (label, formula) in enumerate(DASHBOARD_KPIS):
        r = 4 + i
        ws.cell(row=r, column=1, value=label).font = F_BODY
        ws.cell(row=r, column=1).fill = FILL_KEY
        ws.cell(row=r, column=1).border = BORDER
        cell = ws.cell(row=r, column=2, value=formula)
        cell.font = F_BODY
        cell.border = BORDER
        cell.number_format = MONEY if i not in (1, 2, 7, 8, 9, 10, 11, 12, 13, 14) else "0"
    r = 4 + len(DASHBOARD_KPIS) + 1
    ws.cell(row=r, column=1,
            value="Charts (revenue, orders, payments, househelp, contracts) "
                  "are rendered in the Dee Cleaners web application.").font = F_NOTE
    return ws


def build_archive(wb):
    ws = wb.create_sheet("Archive")
    ws.sheet_properties.tabColor = "888888"
    ws["A1"] = "DEE CLEANERS — ARCHIVED (DELETED) ORDERS"
    ws["A1"].font = F_TITLE
    ws["A2"] = ("Deleted orders are moved here — they are never permanently "
                "removed. Google Sheets is the single source of truth.")
    ws["A2"].font = F_NOTE
    headers = ORDERS_HEADERS + ["Archived Date"]
    for i, h in enumerate(headers, start=1):
        cell = ws.cell(row=3, column=i, value=h)
        cell.font = F_HDR
        cell.fill = FILL_HDR
        cell.alignment = CENTER
        cell.border = BORDER
    ws.freeze_panes = "A4"
    for i in range(1, len(headers) + 1):
        ws.column_dimensions[get_column_letter(i)].width = 14
    return ws


def main():
    wb = Workbook()
    build_settings(wb)
    build_orders(wb)
    build_dashboard(wb)
    for name, headers, n in DATA_SHEETS:
        build_data_sheet(wb, name, headers, n,
                         SKY if name in ("Househelps", "Employers", "Placements",
                                         "Househelp Payments", "Contracts",
                                         "Complaints", "Replacements",
                                         "Attendance")
                         else MIDBLUE)
    build_archive(wb)
    wb.save(OUT)
    print("Created", OUT)


if __name__ == "__main__":
    main()
