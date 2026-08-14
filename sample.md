# PlantUML Local — sample tour

Open this file and press `Ctrl+Shift+V`. Every block below renders locally — no Java, no server, no network.

## Use-case diagram (system boundary, include / extend)

```plantuml
@startuml
left to right direction

actor "Guest" as Guest
actor "Member" as Member
actor "Admin" as Admin

Member <|-- Admin

rectangle "Product" {
  usecase "Browse public items" as View
  usecase "Add to shopping list" as AddShopping
  usecase "Plan meals" as PlanMenu
  usecase "Import recipe ingredients" as ImportRecipe
  usecase "Invite members" as Invite

  PlanMenu ..> ImportRecipe : <<include>>
  AddShopping ..> View : <<extend>>
}

Guest --> View
Member --> AddShopping
Member --> PlanMenu
Admin --> Invite
@enduml
```

## Sequence diagram

```plantuml
@startuml
actor User as U
participant "Shopping list UI" as P
participant "API" as A
database "DB" as D

U -> P : Add an item
P -> A : add()
A -> D : save
D --> A : updated list
A --> P : return list
P --> U : "Item added"
@enduml
```

## State diagram

```plantuml
@startuml
[*] --> Draft

Draft --> NeedsReview : fill in details
NeedsReview --> AwaitingCheck : request review
AwaitingCheck --> Confirmed : approve
AwaitingCheck --> NeedsWork : send back
NeedsWork --> AwaitingCheck : fix and resubmit
Confirmed --> [*]

note right of Draft
  Work in progress.
  Not visible to anyone yet.
end note
@enduml
```

## Class diagram

```plantuml
@startuml
class Inventory {
  +name: string
  +quantity: number
  +consume(amount: number)
}

class Recipe {
  +name: string
}

class MealPlan {
  +date: Date
}

MealPlan "1" o-- "*" Recipe
Recipe "1" *-- "*" Ingredient
Ingredient ..> Inventory : allocates
@enduml
```

## Azure icons (bundled sprite library, no network)

```plantuml
@startuml
!include <azure/AzureCommon>
!include <azure/Networking/AzureApplicationGateway>
!include <azure/Compute/AzureFunction>
!include <azure/Databases/AzureCosmosDb>
!include <azure/Storage/AzureBlobStorage>

LAYOUT_LEFT_RIGHT

AzureApplicationGateway(gw, "受信ゲートウェイ", "Application Gateway")
AzureFunction(fn, "注文API", "Functions")
AzureCosmosDb(db, "注文DB", "Cosmos DB")
AzureBlobStorage(blob, "帳票保管", "Blob Storage")

gw --> fn
fn --> db
fn --> blob
@enduml
```

## Sprite written straight into the diagram

```plantuml
@startuml
sprite $box [8x8/16] {
FFFFFFFF
F000000F
F0FFFF0F
F0F00F0F
F0F00F0F
F0FFFF0F
F000000F
FFFFFFFF
}
rectangle "<$box>\n==inline sprite" as a
@enduml
```

## A library that is not bundled (reported, not fetched)

```plantuml
@startuml
!include <aws/AWSCommon>
Alice -> Bob
@enduml
```

## Syntax error (only this block breaks; everything else stays intact)

```plantuml
@startuml
@@@ this is not valid syntax @@@
@enduml
```

## Remote reference (rejected with an explanation)

```plantuml
@startuml
!include https://example.com/theme.puml
Alice -> Bob
@enduml
```

## Other fenced blocks are untouched

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

```bash
npm run bundle && npm test
```

```json
{ "name": "plantuml-local" }
```
