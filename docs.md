> ## Documentation Index
> Fetch the complete documentation index at: https://razorpay-881012b3.mintlify.site/llms.txt
> Use this file to discover all available pages before exploring further.

# 1. Create the Authorisation Transaction

> Create an authorisation transaction for cards using Razorpay APIs.

<div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"0.35rem 0.9rem",border:"1px solid rgba(128,128,128,0.28)",borderRadius:"0.5rem",padding:"0.45rem 0.75rem",margin:"0 0 1.25rem",fontSize:"0.875rem"}}>
  <span style={{fontWeight:600}}>Available in</span>
  <span>🇮🇳 India</span>
</div>

You can create an authorisation transaction using [Razorpay APIs](#11-using-razorpay-apis) or [Registration Link](#12-using-a-registration-link).

<Warning>
  **Watch Out!**

  Bank downtime can affect success rates when processing recurring payments via debit cards.
</Warning>

## 1.1. Using Razorpay APIs

To create an authorisation transaction using Razorpay APIs, you need to:

1. [Create a Customer](#111-create-a-customer).
2. [Create an Order](#112-create-an-order).
3. [Create Authorisation Payment using Razorpay APIs](#113-create-an-authorisation-payment).

<Info>
  **Handy Tips**

  For the Authorisation Payment to be successful in a day (for example, 5th June), you should create an Order and the Authorisation Transaction on the same day (5th June) before 11:59 pm.
</Info>

### 1.1.1. Create a Customer

Razorpay links recurring tokens to customers using a unique identifier generated through the Customer API.

You can create [customers](/docs/api/customers) with basic information such as `email` and `contact` and use them for various Razorpay offerings. The following endpoint creates a customer.

`POST /customers`

<AccordionGroup>
  <Accordion title="Sample Code">
    <Note>
      ```bash Curl theme={null}
      curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] \
      -X POST https://api.razorpay.com/v1/customers \
      -H "Content-Type: application/json" \
      -d '{
        "name": "<name>",
        "email": "<email>",
        "contact": "<phone>",
        "fail_existing": "0",
        "notes":{
          "note_key_1": "September",
          "note_key_2": "Make it so."
        }
      }'

      ```

      ```java Java theme={null}
      RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

      JSONObject customerRequest = new JSONObject();
      customerRequest.put("name","<name>");
      customerRequest.put("contact","<phone>");
      customerRequest.put("email","<email>");
      customerRequest.put("fail_existing", "0");
      JSONObject notes = new JSONObject();
      notes.put("notes_key_1","Tea, Earl Grey, Hot");
      notes.put("notes_key_2","Tea, Earl Grey… decaf.");
      customerRequest.put("notes",notes);

      Customer customer = razorpay.customers.create(customerRequest);

      ```

      ```python Python theme={null}
      import razorpay
      client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

      client.customer.create({
          'name': '<name>',
          'email': '<email>',
          'contact': '<phone>',
          'fail_existing': "0",
          'notes': {'note_key_1': 'September', 'note_key_2': 'Make it so.'}
          })

      ```

      ```go Go theme={null}
      import ( razorpay "github.com/razorpay/razorpay-go" )
      client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

      data := map[string]interface{}{
          "name": "<name>",
          "contact": <phone>,
          "email": "<email>",
          "fail_existing": "0",
          "notes": map[string]interface{}{
              "notes_key_1": "Tea, Earl Grey, Hot",
              "notes_key_2": "Tea, Earl Grey… decaf.",
          },
      }
      body, err := client.Customer.Create(data, nil)

      ```

      ```php PHP theme={null}
      $api = new Api($key_id, $secret);

      $api->customer->create(array('name' => '<name>', 'email' => '<email>','contact'=>'<phone>','fail_existing' => "0", 'notes'=> array('notes_key_1'=> 'Tea, Earl Grey, Hot','notes_key_2'=> 'Tea, Earl Grey… decaf'));
      ```

      ```csharp .NET theme={null}
      RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

      Dictionary<string, object> options = new Dictionary<string,object>();

      options.Add("name", "<name>"); 
      options.Add("contact", "<phone>"); 
      options.Add("email", "<email>"); 
      options.Add("fail_existing", "0"); 

      Customer customer = Customer.Create(options);

      ```

      ```ruby Ruby theme={null}
      require "razorpay"
      Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

      para_attr = {
        "name": "<name>",
        "contact": "<phone>",
        "email": "<email>",
        "fail_existing": "0",
        "notes": {
          "notes_key_1": "Tea, Earl Grey, Hot",
          "notes_key_2": "Tea, Earl Grey… decaf."
        }
      }

      Razorpay::Customer.create(para_attr)

      ```

      ```javascript Node.js theme={null}
      var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

      instance.customers.create({
        name: "<name>",
        contact: "<phone>",
        email: "<email>",
        fail_existing: "0",
        notes: {
          notes_key_1: "Tea, Earl Grey, Hot",
          notes_key_2: "Tea, Earl Grey… decaf."
        }
      })
      ```

      ```json Response theme={null}
      {
        "id":"cust_1Aa00000000001",
        "entity":"customer",
        "name":"<name>",
        "email":"<email>",
        "contact":"<phone>",
        "gstin":null,
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "created_at ":1234567890
      }
      ```
    </Note>
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Request Parameters">
    `name`
    : `string` The name of the customer. For example, `Gaurav Kumar`.

    `email`
    : `string` The email address of the customer. For example, `gaurav.kumar@example.com`.

    `contact`
    : `string` The phone number of the customer. For example, `9876543210`.

    `fail_existing` *optional*
    : `string` The request throws an exception by default if a customer with the exact details already exists. You can pass an additional parameter `fail_existing` to get the existing customer's details in the response. Possible values:

    * `1` (default): If a customer with the same details already exists, throws an error.
    * `0`: If a customer with the same details already exists, fetches details of the existing customer.

    `notes` *optional*
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` The unique identifier of the customer. For example `cust_1Aa00000000001`.

    `entity`
    : `string` The name of the entity. Here, it is `customer`.

    `name`
    : `string` The name of the customer. For example, `Gaurav Kumar`.

    `email`
    : `string` The email address of the customer. For example, `gaurav.kumar@example.com`.

    `contact`
    : `string` The phone number of the customer. For example, `9876543210`.

    `notes`
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.

    `created_at`
    : `integer` A Unix timestamp, at which the customer was created.

    You can create an order once you create a customer for the payment authorisation.
  </Accordion>
</AccordionGroup>

### 1.1.2. Create an Order

Use the [Orders API](/docs/api/orders) to create a unique Razorpay `order_id` that is associated with the authorisation transaction. The following endpoint creates an order.

`POST /orders`

```bash Curl theme={null}
curl -u <YOUR_KEY_ID>:<YOUR_KEY_SECRET> \
-X POST https://api.razorpay.com/v1/orders \
-H "Content-Type: application/json" \
-d '{
   "amount":100,
   "currency":"INR",
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "method":"card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 2709971120,
    "frequency": "monthly"
  },
   "receipt":"Receipt No. 1",
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf."
   }
}'

```

```java Java theme={null}
RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

JSONObject orderRequest = new JSONObject();
orderRequest.put("amount", 100);
orderRequest.put("currency", "INR");
orderRequest.put("customer_id", "cust_4xbQrmEoA5WJ01");
orderRequest.put("method", "card");
JSONObject token = new JSONObject();
token.put("max_amount","100000000"); 
token.put("expire_at","2709971120");
token.put("frequency","monthly");
orderRequest.put("token", token);
orderRequest.put("receipt", "receipt#1");
JSONObject notes = new JSONObject();
notes.put("notes_key_1","Tea, Earl Grey, Hot");
notes.put("notes_key_2","Tea, Earl Grey… decaf.");
orderRequest.put("notes", notes);

Order order = razorpay.orders.create(orderRequest);

```

```php PHP theme={null}
$api = new Api($key_id, $secret);

$api->order->create(array('amount' => 100, 'currency' => 'INR',  'receipt' => '123', 'customer_id'=> $customerId, 'method'=>'card', 'token' => array('max_amount' => 100000000, 'expire_at' => 2709971120, 'frequency' => 'monthly'), 'notes'=> array('key1'=> 'value3','key2'=> 'value2')));

```

```javascript Node.js theme={null}
var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

instance.orders.create({
   "amount":100,
   "currency":"INR",
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "method":"card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt":"Receipt No. 1",
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf."
   }
})

```

```python Python theme={null}
client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

client.order.create({
    'amount': 50000,
    'currency': 'INR',
    'customer_id': 'cust_4xbQrmEoA5WJ01',
    'method': 'card',
    'token':{
      'max_amount': 100000000,
      'expire_at': 4102444799,
      'frequency': 'monthly'
   },
    'receipt': 'receipt#1',
    'notes': {'key1': 'value3', 'key2': 'value2'}
    })

```

```ruby Ruby theme={null}
require "razorpay"
Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

param_attr = {
   "amount":100,
   "currency": "INR",
   "customer_id": "cust_4xbQrmEoA5WJ01",
   "method": "card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt": "Receipt No. 1",
   "notes":{
      "notes_key_1": "Tea, Earl Grey, Hot",
      "notes_key_2": "Tea, Earl Grey... decaf."
   }
}

Razorpay::Order.create(para_attr)

```

```go Go theme={null}
import ( razorpay "github.com/razorpay/razorpay-go" )
client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

data := map[string]interface{}{
   "amount":100,
   "currency":"INR",
   "customer_id":"<customerId>",
   "method":"card",
   "token":map[string]interface{}{
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt":"Receipt No. 1",
   "notes":map[string]interface{}{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf.",
   },
}
body, err := client.Order.Create(data, nil)

```

```csharp .NET theme={null}
RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

Dictionary<string, object> orderRequest = new Dictionary<string, object>();
orderRequest.Add("amount", 100);
orderRequest.Add("currency", "INR");
orderRequest.Add("customer_id", "cust_Z6t7VFTb9xHeOs");
orderRequest.Add("method", "card");
Dictionary<string, object> token = new Dictionary<string, object>();
token.Add("max_amount", "5000");
token.Add("expire_at", "2709971120");
token.Add("frequency", "monthly");
orderRequest.Add("token", token);
orderRequest.Add("receipt", "receipt#176");
Dictionary<string, object> notes = new Dictionary<string, object>();
notes.Add("notes_key_1", "Tea, Earl Grey, Hot");
notes.Add("notes_key_2", "Tea, Earl Grey… decaf.");
orderRequest.Add("notes", notes);

Order order = client.Order.Create(orderRequest);
```

```json Response theme={null}
{
   "id":"order_1Aa00000000002",
   "entity":"order",
   "amount":100,
   "amount_paid":0,
   "amount_due":100,
   "currency":"INR",
   "receipt":"Receipt No. 1",
   "method":"card",
   "description":null,
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "offer_id":null,
   "status":"created",
   "attempts":0,
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey… decaf."
   },
   "created_at":1565172642
}
```

<AccordionGroup>
  <Accordion title="Request Parameters">
    `amount` *mandatory*
    : `integer` Amount in currency subunits. For cards, the amount should be `100`, that is, <currency MY="0.10" IN="1" SG="0.5" US="1" />.

    `currency` *mandatory*
    : `string` The 3-letter ISO currency code for the payment.

    `customer_id` *mandatory*
    : `string` The unique identifier of the customer. For example, `cust_4xbQrmEoA5WJ01`.

    `method` *optional*
    : `string` Payment method used to make the authorisation transaction. Here, it is `card`.

    `token`
    : `object` Details related to the authorisation such as max amount, frequency and expiry information.

    `max_amount` *mandatory*
    : `integer` The maximum amount that can be auto-debited in a single charge. The minimum value is `100`, that is, <currency MY="1" IN="1" SG="1" US="1" />, and the maximum value is `1500000`, that is, <currency MY="10000" IN="15000" SG="10000" US="10000" />. For an amount higher than this, the cardholder should provide an Additional Factor of Authentication (AFA) as per RBI guidelines.

    `expire_at` *mandatory*
    : `integer` The Unix timestamp that indicates when the authorisation transaction must expire. The card's expiry year is considered a default value.

    `frequency` *mandatory*
    : `string` The frequency at which you can charge your customer. Possible values:

    * `weekly`
    * `monthly`
    * `yearly`
    * `as_presented`

    `receipt` *optional*
    : `string` A user-entered unique identifier for the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `notes`*optional*
    : `object` Key-value pair you can use to store additional information about the entity. Maximum 15 key-value pairs, 256 characters each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` A unique identifier of the order created. For example `order_1Aa00000000002`.

    `entity`
    : `string` The entity that has been created. Here it is `order`.

    `amount`
    : `integer` Amount in currency subunits. For cards, the amount should be `100`, that is, <currency MY="0.10" IN="1" SG="0.5" US="1" />.

    `amount_paid`
    : `integer` The amount that has been paid.

    `amount_due`
    : `integer` The amount that is yet to pay.

    `currency`
    : `string` The 3-letter ISO currency code for the payment.

    `receipt`
    : `string` A user-entered unique identifier of the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `method`
    : `string` Payment method used to make the authorisation transaction. Here, it is `card`.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_4xbQrmEoA5WJ01`.

    `status`
    : `string` The status of the order.

    `notes`
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.

    `created_at`
    : `integer` The Unix timestamp at which the order was created.

    You can create a payment against the `order_id` after you create an order.
  </Accordion>
</AccordionGroup>

### 1.1.3. Create an Authorisation Payment

Create a payment checkout form for customers to make Authorisation Transaction and register their mandate. You can use the Handler Function or Callback URL.

| Handler Function                                                                                                                                                                                                                                  | Callback URL                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When you use the handler function, the response object of the successful payment (`razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`) is submitted to the Checkout Form. You need to collect these and send them to your server. | When you use a Callback URL, the response object of the successful payment (`razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`) is submitted to the Callback URL. |

<Warning>
  **Watch Out!**

  * The callback URL is not supported for recurring payments created using the registration link.
  * While handling the first time authorisation payment response, consume the `error_reason` field with value `upi_dummy_payment` and `error_description` field with value `Payment was a dummy payment for one time mandate registration.` to identify successful mandate registration. The parent `error_code` will be `BAD_REQUEST_ERROR`.
</Warning>

<Note>
  ```html Checkout with handler functions theme={null}
  <button id = "rzp-button1"> Pay </button>
    <script src = "https://checkout.razorpay.com/v1/checkout.js"> </script>
    <script>
      var options = {
        "key": "[YOUR_KEY_ID]",
        "order_id": "order_1Aa00000000001",
        "customer_id": "cust_1Aa00000000001",
        "recurring": true,
        "handler": function (response) {
          alert(response.razorpay_payment_id);
          alert(response.razorpay_order_id);
          alert(response.razorpay_signature);
        },
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "theme": {
          "color": "#F37254"
        }
      };
      var rzp1 = new Razorpay(options);
      document.getElementById('rzp-button1').onclick = function (e) {
        rzp1.open();
        e.preventDefault();
      }
    </script>
  ```

  ```html Manual checkout with Callback URL theme={null}
  <button id = "rzp-button1"> Pay </button>
    <script src = "https://checkout.razorpay.com/v1/checkout.js"> </script>
    <script>
      var options = {
        "key": "[YOUR_KEY_ID]",
        "order_id": "order_1Aa00000000001",
        "customer_id": "cust_1Aa00000000001",
        "recurring": true,
        "callback_url": "https://eneqd3r9zrjok.x.pipedream.net/",
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "theme": {
          "color": "#F37254"
        }
      };
      var rzp1 = new Razorpay(options);
      document.getElementById('rzp-button1').onclick = function (e) {
        rzp1.open();
        e.preventDefault();
      }
    </script>
  ```
</Note>

<AccordionGroup>
  <Accordion title="Additional Checkout Fields">
    You should send the following additional parameters along with the existing checkout options as a part of the authorisation transaction.

    `customer_id` *mandatory*
    : `string` Unique identifier of the customer created in the [first step](#111-create-a-customer).

    `order_id` *mandatory*
    : `string` Unique identifier of the  order created in the [second step](#112-create-an-order).

    `recurring` *mandatory*
    : `boolean` Possible values:

    * `true`: Recurring payment is enabled.
    * `false`: Recurring payment is not enabled.

    <Info>
      **Handy Tips**

      The `recurring` parameter also supports the value `preferred`. Use this when you want to support recurring payments and one-time payment in the same flow.
    </Info>
  </Accordion>
</AccordionGroup>

After this step, you can proceed to integrate with the [Fetch Token API](/docs/api/payments/recurring-payments/cards/tokens).

## 1.2. Using a Registration Link

Registration Link is an alternate way of creating an authorisation transaction. You can create a registration link using the API or [Dashboard](/docs/payments/recurring-payments/create#1-create-a-registration-link).

* You do not have to create a customer if you choose the registration link method for creating an authorisation transaction.

* When you create a registration link, an [invoice](/docs/payments/invoices) is automatically issued to the customer. They can use this invoice to make the authorisation payment.

* A registration link should always have an order amount (in subunits) the customer will be charged when making the authorisation payment. For cards, the amount should be <currency MY="0.10" IN="1" SG="0.5" US="1" /> in the case of cards.

<Info>
  **Handy Tips**

  You can [use Webhooks to get notifications about successful payments](/docs/api/payments/recurring-payments/webhooks#check-authorization-link-status-using-webhooks) against a registration link.
</Info>

### 1.2.1. Create a Registration Link

The following endpoint creates a registration link.

`POST /subscription_registration/auth_links`

```bash Curl theme={null}
curl -u <YOUR_KEY_ID>:<YOUR_KEY_SECRET>
-X POST https://api.razorpay.com/v1/subscription_registration/auth_links
-H "Content-Type: application/json" \
-d '{
  "customer":{
    "name":"<name>",
    "email":"<email>",
    "contact":"<phone>"
  },
  "type":"link",
  "amount":"100",
  "currency":"INR",
  "description":"Registration Link for <name>",
  "subscription_registration":{
    "method":"card",
    "max_amount":"1000000",
    "expire_at":1609423824,
    "frequency": "monthly"
  },
  "receipt":"Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1580479824,
  "notes":{
    "note_key 1":"Beam me up Scotty",
    "note_key 2":"Tea. Earl Gray. Hot."
  }
}'

```

```java Java theme={null}
RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

JSONObject registrationLinkRequest = new JSONObject();
JSONObject customer = new JSONObject();
customer.put("name","<name>");
customer.put("email","<email>");
customer.put("contact","<phone>");
registrationLinkRequest.put("customer", customer);
registrationLinkRequest.put("type", "link");
registrationLinkRequest.put("amount", 100);
registrationLinkRequest.put("currency", "INR");
registrationLinkRequest.put("description", "Registration Link for <name>");
JSONObject subscriptionRegistration = new JSONObject();
subscriptionRegistration.put("method","card");
subscriptionRegistration.put("max_amount",1000000);
subscriptionRegistration.put("expire_at",1609423824);
subscriptionRegistration.put("frequency","monthly");
registrationLinkRequest.put("subscription_registration", subscriptionRegistration);
registrationLinkRequest.put("receipt", "Receipt No. 1");
registrationLinkRequest.put("email_notify", true);
registrationLinkRequest.put("sms_notify", true);
registrationLinkRequest.put("expire_by", 1580479824);
JSONObject notes = new JSONObject();
notes.put("notes_key_1","Tea, Earl Grey, Hot");
notes.put("notes_key_2","Tea, Earl Grey… decaf.");
registrationLinkRequest.put("notes", notes);

Invoice invoice = razorpay.invoices.createRegistrationLink(registrationLinkRequest);

```

```php PHP theme={null}
$api = new Api($key_id, $secret);

$api->subscription->createSubscriptionRegistration(array('customer'=>array('name'=>'<name>','email'=>'<email>','contact'=>'<phone>'),'type'=>'link','amount'=>100,'currency'=>'INR','description'=>'Registration Link for <name>','subscription_registration'=>array('method'=>'card','max_amount'=>'1000000','expire_at'=>'1634215992','frequency'=>'monthly'),'receipt'=>'Receipt No. 5','email_notify'=> true,'sms_notify'=>true,'expire_by'=>1634215992, 'notes'=> array('note_key 1'=> 'Beam me up Scotty','note_key 2'=> 'Tea. Earl Gray. Hot.')));
```

```javascript Node.js theme={null}
var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

instance.subscriptions.createRegistrationLink({
  customer: {
    name: "<name>",
    email: "<email>",
    contact: "<phone>"
  },
  type: "link",
  amount: 100,
  currency: "INR",
  description: "Registration Link for <name>",
  subscription_registration: {
    method: "card",
    max_amount: 1000000,
    expire_at: 1609423824,
    frequency: "monthly"
  },
  receipt: "Receipt No. 1",
  email_notify: true,
  sms_notify: true,
  expire_by: 1580479824,
  notes: {
    notes_key_1: "Tea, Earl Grey, Hot",
    notes_key_2: "Tea, Earl Grey... decaf."
  }
})
```

```python Python theme={null}
client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

client.registration_link.create({
    'customer': {'name': '<name>',
                 'email': '<email>',
                 'contact': '<phone>'},
    'type': 'link',
    'amount': '100',
    'currency': 'INR',
    'description': 'Registration Link for Gaurav',
    'subscription_registration': {'method': 'card', 'max_amount': '1000000'
                                  , 'expire_at': 1644737663, 'frequency': 'monthly'},
    'receipt': 'Receipt No. #11',
    'email_notify': True,
    'sms_notify': True,
    'expire_by': 1644737663,
    'notes': {'note_key 1': 'Beam me up Scotty',
              'note_key 2': 'Tea. Earl Gray. Hot.'}
    })

```

```ruby Ruby theme={null}
require "razorpay"
Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

para_attr = {
  "customer":{
    "name": "<name>",
    "email": "<email>",
    "contact": "<phone>"
  },
  "type": "link",
  "amount": "100",
  "currency": "INR",
  "description": "Registration Link for <name>",
  "subscription_registration":{
    "method": "card",
    "max_amount": "1000000",
    "expire_at": 1609423824,
    "frequency": "monthly"
  },
  "receipt": "Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1580479824,
  "notes":{
    "note_key 1": "Beam me up Scotty",
    "note_key 2": "Tea. Earl Gray. Hot."
  }
}

Razorpay::SubscriptionRegistration.create(para_attr)

```

```go Go theme={null}
import ( razorpay "github.com/razorpay/razorpay-go" )
client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

data:= map[string]interface{}{
  "customer":map[string]interface{}{
    "name":"<name>",
    "email":"<email>",
    "contact":"<phone>",
  },
  "type":"link",
  "amount":"100",
  "currency":"INR",
  "description":"Registration Link for <name>",
  "subscription_registration":map[string]interface{}{
    "method":"card",
    "max_amount":"1000000",
    "expire_at":1609423824,
    "frequency": "monthly"
  },
  "receipt":"Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1681987284,
  "notes":map[string]interface{}{
    "note_key 1":"Beam me up Scotty",
    "note_key 2":"Tea. Earl Gray. Hot.",
  },
}

body, err := client.Invoice.CreateRegistrationLink(data, nil)

```

```csharp .NET theme={null}
RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

Dictionary<string, object> registrationLinkRequest = new Dictionary<string, object>();
Dictionary<string, object> customer = new Dictionary<string, object>();
customer.Add("name", "<name>");
customer.Add("email", "<email>");
customer.Add("contact", "<phone>");
registrationLinkRequest.Add("customer", customer);
registrationLinkRequest.Add("type", "link");
registrationLinkRequest.Add("amount", 100);
registrationLinkRequest.Add("currency", "INR");
registrationLinkRequest.Add("description", "Registration Link for <name>");
Dictionary<string, object> subscriptionRegistration = new Dictionary<string, object>();
subscriptionRegistration.Add("method", "card");
subscriptionRegistration.Add("max_amount", 1000000);
subscriptionRegistration.Add("expire_at", 1609423824);
registrationLinkRequest.Add("subscription_registration", subscriptionRegistration);
registrationLinkRequest.Add("receipt", "Receipt No. #18d");
registrationLinkRequest.Add("email_notify", true);
registrationLinkRequest.Add("sms_notify", true);
registrationLinkRequest.Add("expire_by", 1580479824);
Dictionary<string, object> notes = new Dictionary<string, object>();
notes.Add("notes_key_1", "Tea, Earl Grey, Hot");
notes.Add("notes_key_2", "Tea, Earl Grey… decaf.");
registrationLinkRequest.Add("notes", notes);

Invoice invoice = client.Invoice.CreateRegistrationLink(registrationLinkRequest);
```

```json Response theme={null}
{
  "id": "inv_FHrXGIpd3N17DX",
  "entity": "invoice",
  "receipt": "Receipt No. 24",
  "invoice_number": "Receipt No. 24",
  "customer_id": "cust_BMB3EwbqnqZ2EI",
  "customer_details": {
    "id": "cust_BMB3EwbqnqZ2EI",
    "name": "<name>",
    "email": "<email>",
    "contact": "<phone>",
    "gstin": null,
    "billing_address": null,
    "shipping_address": null,
    "customer_name": "<name>",
    "customer_email": "<email>",
    "customer_contact": "<phone>"
  },
  "order_id": "order_FHrXGJNngJyEAe",
  "line_items": [],
  "payment_id": null,
  "status": "issued",
  "expire_by": 4102444799,
  "issued_at": 1595491014,
  "paid_at": null,
  "cancelled_at": null,
  "expired_at": null,
  "sms_status": "pending",
  "email_status": "pending",
  "date": 1595491014,
  "terms": null,
  "partial_payment": false,
  "gross_amount": 100,
  "tax_amount": 0,
  "taxable_amount": 0,
  "amount": 100,
  "amount_paid": 0,
  "amount_due": 100,
  "currency": "INR",
  "currency_symbol": "₹",
  "description": "Registration Link for <name>",
  "notes": {
    "note_key 1": "Beam me up Scotty",
    "note_key 2": "Tea. Earl Gray. Hot."
  },
  "comment": null,
  "short_url": "https://rzp.io/i/VSriCfn",
  "view_less": true,
  "billing_start": null,
  "billing_end": null,
  "type": "link",
  "group_taxes_discounts": false,
  "created_at": 1595491014,
  "idempotency_key": null
}
```

<AccordionGroup>
  <Accordion title="Request Parameters">
    `customer`
    : `object` Details of the customer to whom the registration link is sent.

    `name` *mandatory*
    : `string` Customer's name.

    `email` *mandatory*
    : `string` Customer's email address.

    `contact`*mandatory*
    : `integer` Customer's contact number.

    `type` *mandatory*
    : `string` In this case, the value is `link`.

    `amount` *mandatory*
    : `integer` The payment amount in the smallest currency sub-unit.

    `currency` *mandatory*
    : `string` The 3-letter ISO currency code for the payment.

    `description` *mandatory*
    : `string` A description that appears on the hosted page.

    `subscription_registration`
    : `object` Details of the authorisation transaction.

    `method` *mandatory*
    : `string` The authorisation method. Here it is `card`.

    `max_amount` *mandatory*
    : `integer` The maximum amount that can be auto-debited in a single charge. The minimum value is `100` (₹1) and the maximum value is `100000000` (₹10,00,000). For an amount higher than this or the RBI limit of ₹15,000 (`1500000`) or ₹1,00,000 (`10000000`) respectively, the cardholder should provide an Additional Factor of Authentication (AFA) as per RBI guidelines.

    `expire_at` *optional*
    : `integer` The Unix timestamp till when you can use the token (authorisation on the payment method) to charge the customer subsequent payments. The card's expiry year is considered a default value.

    `frequency` *mandatory*
    : `string` The frequency at which you can charge your customer. Possible values:

    * `weekly`
    * `monthly`
    * `yearly`
    * `as_presented`

    `sms_notify` *optional*
    : `boolean` Indicates if SMS notifications are to be sent by Razorpay. Possible values:

    * `true` (default): Notifications are sent by Razorpay .
    * `false`: Notifications are not sent by Razorpay.

    `email_notify` *optional*
    : `boolean` Indicates if email notifications are to be sent by Razorpay. Possible values:

    * `true` (default): Notifications are sent by Razorpay .
    * `false`: Notifications are not sent by Razorpay.

    `expire_by` *optional*
    : `integer` The Unix timestamp indicates the expiry of the registration link.

    `receipt` *optional*
    : `string` A unique identifier entered by you for the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `notes` *optional*
    : `object` This is a key-value pair that is used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` The unique identifier of the invoice.

    `entity`
    : `string` The entity that has been created. Here, it is `invoice`.

    `receipt`
    : `string` A user-entered unique identifier of the invoice.

    `invoice_number`
    : `string` Unique number you added for internal reference.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_BMB3EwbqnqZ2EI`.

    `customer_details`
    : `object` Details of the customer.

    `id`
    : `string` The unique identifier associated with the customer to whom the invoice has been issued.

    `name`
    : `string` The customer's name.

    `email`
    : `string` The customer's email address.

    `contact`
    : `integer` The customer's phone number.

    `billing_address`
    : `string` Details of the customer's billing address.

    `shipping_address`
    : `string` Details of the customer's shipping address.

    `order_id`
    : `string` The unique identifier of the order associated with the invoice.

    `line_items`
    : `string` Details of the line item that is billed in the invoice. Maximum of 50 line items are allowed.

    `payment_id`
    : `string` Unique identifier of a payment made against the invoice.

    `status`
    : `string` The status of the invoice. Possible values:

    * `draft`
    * `issued`
    * `partially_paid`
    * `paid`
    * `cancelled`
    * `expired`
    * `deleted`

    `expire_by`
    : `integer` The Unix timestamp at which the invoice will expire.

    `issued_at`
    : `integer` The Unix timestamp at which the invoice was issued to the customer.

    `paid_at`
    : `integer` The Unix timestamp at which the payment was made.

    `cancelled_at`
    : `integer` The Unix timestamp at which the invoice was cancelled.

    `expired_at`
    : `integer` The Unix timestamp at which the invoice expired.

    `sms_status`
    : `string` The delivery status of the SMS notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `email_status`
    : `string` The delivery status of the email notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `date`
    : `integer` Timestamp, in Unix format, that indicates the issue date of the invoice.

    `terms`
    : `string` Any terms to be included in the invoice. Maximum of 2048 characters.

    `partial_payment`
    : `boolean` Indicates whether the customer can make a partial payment on the invoice. Possible values:

    * `true`:  The customer can make partial payments.
    * `false` (default): The customer cannot make partial payments.

    `amount`
    : `integer` Amount to be paid using the invoice. Must be in the smallest unit of the currency. For example, if the amount to be received from the customer is <currency MY="299.95" IN="299.95" SG="299.95" US="299.95" />, pass the value as `29995`.

    `amount_paid`
    : `integer` Amount paid by the customer against the invoice.

    `amount_due`
    : `integer` The remaining amount to be paid by the customer for the issued invoice.

    `currency`
    : `string` The currency associated with the invoice.

    `description`
    : `string`  A brief description of the invoice.

    `notes`
    : `object` Any custom notes added to the invoice. Maximum of 2048 characters.

    `short_url`
    : `string` The short URL that is generated. This is the link that can be shared with the customer to receive payments.

    `type`
    : `string` Here, it is `invoice`.

    `comment`
    : `string` Any comments to be added in the invoice. Maximum of 2048 characters.
  </Accordion>
</AccordionGroup>

### 1.2.2. Send/Resend Notifications

The following endpoint sends/resends notifications with the short URL to the customer:

`POST /invoices/:id/notify_by/:medium`

<AccordionGroup>
  <Accordion title="Sample Code">
    ```bash Curl theme={null}
     curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET]
     -X POST https://api.razorpay.com/v1/invoices/inv_1Aa00000000001/notify_by/sms

    ```

    ```java Java theme={null}
    RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    String invoiceId = "inv_1Aa00000000001";

    String medium = "sms";

    Invoice invoice = razorpay.invoices.notifyBy(invoiceId, medium);

    ```

    ```php PHP theme={null}
    $api = new Api($key_id, $secret);

    $api->invoice->fetch($invoiceId)->notify($medium);

    ```

    ```javascript Node.js theme={null}
    var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

    instance.invoices.notifyBy(invoiceId, medium)


    ```

    ```python Python theme={null}
    client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

    client.invoice.notify_by(invoiceId, medium)

    ```

    ```ruby Ruby theme={null}
    require "razorpay"
    Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

    invoiceId = "inv_JDdNb4xdf4gxQ7"

    medium = "email" 

    Razorpay::Invoice.notify_by(invoiceId, medium)

    ```

    ```go Go theme={null}
    import ( razorpay "github.com/razorpay/razorpay-go" )
    client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

    body, err := client.Invoice.Notify("<invoiceId>", "<medium>", nil, nil)

    ```

    ```csharp .NET theme={null}
    RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    string invoiceId = "inv_Z6t7VFTb9xHeOs";

    string medium = "sms";

    Invoice invoice = client.Invoice.Fetch(invoiceId).NotifyBy(medium);
    ```

    ```json Response theme={null}
    {
      "success": true
    }
    ```
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Path Parameters">
    `id`*mandatory*
    : `string` The unique identifier of the invoice linked to the registration link for which you want to send the notification. For example, `inv_1Aa00000000001`.

    `medium` *mandatory*
    : `string` Determines through which medium you want to resend the notification. Possible values:

    * `sms`
    * `email`
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameter">
    `success`
    : `boolean` Indicates whether the notifications were sent successfully. Possible values:

    * `true`: The notifications were successfully sent via SMS, email or both.
    * `false`: The notifications were not sent.
  </Accordion>
</AccordionGroup>

### 1.2.3. Cancel a Registration Link

The following endpoint cancels a registration link.

`POST /invoices/:id/cancel`

<Info>
  **Handy Tips**

  You can only cancel registration link in the `issued` state.
</Info>

<AccordionGroup>
  <Accordion title="Sample Code">
    ```bash Curl theme={null}
     curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET]
     -X POST https://api.razorpay.com/v1/invoices/inv_1Aa00000000001/cancel

    ```

    ```java Java theme={null}
    RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    String invoiceId = "inv_1Aa00000000001";

    Invoice invoice = razorpay.invoices.cancel(invoiceId);

    ```

    ```php PHP theme={null}
    $api = new Api($key_id, $secret);

    $api->invoice->fetch($invoiceId)->cancel();
    ```

    ```javascript Node.js theme={null}
    var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

    instance.invoices.cancel(invoiceId)

    ```

    ```python Python theme={null}
    client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

    client.invoice.cancel(invoiceId)

    ```

    ```ruby Ruby theme={null}
    require "razorpay"
    Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

    invoiceId = "inv_1Aa00000000001"

    Razorpay::Invoice.cancel(invoiceId)

    ```

    ```go Go theme={null}
    import ( razorpay "github.com/razorpay/razorpay-go" )
    client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

    body, err := client.Invoice.Cancel("<invoiceId>", nil, nil)

    ```

    ```csharp .NET theme={null}
    RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    string invoiceId = "inv_Z6t7VFTb9xHeOs";

    Invoice invoice = client.Invoice.Fetch(invoiceId).Cancel();
    ```

    ```json Response theme={null}
    {
      "id": "inv_FHrfRupD2ouKIt",
      "entity": "invoice",
      "receipt": "Receipt No. 1",
      "invoice_number": "Receipt No. 1",
      "customer_id": "cust_BMB3EwbqnqZ2EI",
      "customer_details": {
          "id": "cust_BMB3EwbqnqZ2EI",
          "name": "<name>",
          "email": "<email>",
          "contact": "<phone>",
          "gstin": null,
          "billing_address": null,
          "shipping_address": null,
          "customer_name": "<name>",
          "customer_email": "<email>",
          "customer_contact": "<phone>"
      },
      "order_id": "order_FHrfRw4TZU5Q2L",
      "line_items": [],
      "payment_id": null,
      "status": "cancelled",
      "expire_by": 4102444799,
      "issued_at": 1595491479,
      "paid_at": null,
      "cancelled_at": 1595491488,
      "expired_at": null,
      "sms_status": "sent",
      "email_status": "sent",
      "date": 1595491479,
      "terms": null,
      "partial_payment": false,
      "gross_amount": 100,
      "tax_amount": 0,
      "taxable_amount": 0,
      "amount": 100,
      "amount_paid": 0,
      "amount_due": 100,
      "currency": "INR",
      "currency_symbol": "₹",
      "description": "Registration Link for Gaurav Kumar",
      "notes": {
          "note_key 1": "Beam me up Scotty",
          "note_key 2": "Tea. Earl Gray. Hot."
      },
      "comment": null,
      "short_url": "https://rzp.io/i/QlfexTj",
      "view_less": true,
      "billing_start": null,
      "billing_end": null,
      "type": "link",
      "group_taxes_discounts": false,
      "created_at": 1595491480,
      "idempotency_key": null
    }

    ```
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Path Parameter">
    `id` *mandatory*
    : `string` The unique identifier for the invoice linked to the registration link that you want to cancel. For example, `inv_1Aa00000000001`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameter">
    `id`
    : `string` The unique identifier of the invoice.

    `entity`
    : `string` The entity that has been created. Here, it is `invoice`.

    `receipt`
    : `string` A user-entered unique identifier of the invoice.

    `invoice_number`
    : `string` Unique number you added for internal reference.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_BMB3EwbqnqZ2EI`.

    `customer_details`
    : `object` Details of the customer.

    `id`
    : `string` The unique identifier associated with the customer to whom the invoice has been issued.

    `name`
    : `string` The customer's name.

    `email`
    : `string` The customer's email address.

    `contact`
    : `integer` The customer's phone number.

    `billing_address`
    : `string` Details of the customer's billing address.

    `shipping_address`
    : `string` Details of the customer's shipping address.

    `order_id`
    : `string` The unique identifier of the order associated with the invoice.

    `line_items`
    : `string` Details of the line item that is billed in the invoice. Maximum of 50 line items are allowed.

    `payment_id`
    : `string` Unique identifier of a payment made against the invoice.

    `status`
    : `string` The status of the invoice. Possible values:

    * `draft`
    * `issued`
    * `partially_paid`
    * `paid`
    * `cancelled`
    * `expired`
    * `deleted`

    `expire_by`
    : `integer` The Unix timestamp at which the invoice will expire.

    `issued_at`
    : `integer` The Unix timestamp at which the invoice was issued to the customer.

    `paid_at`
    : `integer` The Unix timestamp at which the payment was made.

    `cancelled_at`
    : `integer` The Unix timestamp at which the invoice was cancelled.

    `expired_at`
    : `integer` The Unix timestamp at which the invoice expired.

    `sms_status`
    : `string` The delivery status of the SMS notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `email_status`
    : `string` The delivery status of the email notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `date`
    : `integer` Timestamp, in Unix format, that indicates the issue date of the invoice.

    `terms`
    : `string` Any terms to be included in the invoice. Maximum of 2048 characters.

    `partial_payment`
    : `boolean` Indicates whether the customer can make a partial payment on the invoice. Possible values:

    * `true`:  The customer can make partial payments.
    * `false` (default): The customer cannot make partial payments.

    `amount`
    : `integer` Amount to be paid using the invoice. Must be in the smallest unit of the currency. For example, if the amount to be received from the customer is <currency MY="299.95" IN="299.95" SG="299.95" US="299.95" />, pass the value as `29995`.

    `amount_paid`
    : `integer` Amount paid by the customer against the invoice.

    `amount_due`
    : `integer` The remaining amount to be paid by the customer for the issued invoice.

    `currency`
    : `string` The currency associated with the invoice.

    `description`
    : `string`  A brief description of the invoice.

    `notes`
    : `object` Any custom notes added to the invoice. Maximum of 2048 characters.

    `short_url`
    : `string` The short URL that is generated. This is the link that can be shared with the customer to receive payments.

    `type`
    : `string` Here, it is `invoice`.

    `comment`
    : `string` Any comments to be added in the invoice. Maximum of 2048 characters.
  </Accordion>
</AccordionGroup>

After this step, you can proceed to integrate with the [Fetch Token API](/docs/api/payments/recurring-payments/cards/tokens).
------




> ## Documentation Index
> Fetch the complete documentation index at: https://razorpay-881012b3.mintlify.site/llms.txt
> Use this file to discover all available pages before exploring further.



# 1. Create the Authorisation Transaction

> Create an authorisation transaction for cards using Razorpay APIs.

<div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"0.35rem 0.9rem",border:"1px solid rgba(128,128,128,0.28)",borderRadius:"0.5rem",padding:"0.45rem 0.75rem",margin:"0 0 1.25rem",fontSize:"0.875rem"}}>
  <span style={{fontWeight:600}}>Available in</span>
  <span>🇮🇳 India</span>
</div>

You can create an authorisation transaction using [Razorpay APIs](#11-using-razorpay-apis) or [Registration Link](#12-using-a-registration-link).

<Warning>
  **Watch Out!**

  Bank downtime can affect success rates when processing recurring payments via debit cards.
</Warning>

## 1.1. Using Razorpay APIs

To create an authorisation transaction using Razorpay APIs, you need to:

1. [Create a Customer](#111-create-a-customer).
2. [Create an Order](#112-create-an-order).
3. [Create Authorisation Payment using Razorpay APIs](#113-create-an-authorisation-payment).

<Info>
  **Handy Tips**

  For the Authorisation Payment to be successful in a day (for example, 5th June), you should create an Order and the Authorisation Transaction on the same day (5th June) before 11:59 pm.
</Info>

### 1.1.1. Create a Customer

Razorpay links recurring tokens to customers using a unique identifier generated through the Customer API.

You can create [customers](/docs/api/customers) with basic information such as `email` and `contact` and use them for various Razorpay offerings. The following endpoint creates a customer.

`POST /customers`

<AccordionGroup>
  <Accordion title="Sample Code">
    <Note>
      ```bash Curl theme={null}
      curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] \
      -X POST https://api.razorpay.com/v1/customers \
      -H "Content-Type: application/json" \
      -d '{
        "name": "<name>",
        "email": "<email>",
        "contact": "<phone>",
        "fail_existing": "0",
        "notes":{
          "note_key_1": "September",
          "note_key_2": "Make it so."
        }
      }'

      ```

      ```java Java theme={null}
      RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

      JSONObject customerRequest = new JSONObject();
      customerRequest.put("name","<name>");
      customerRequest.put("contact","<phone>");
      customerRequest.put("email","<email>");
      customerRequest.put("fail_existing", "0");
      JSONObject notes = new JSONObject();
      notes.put("notes_key_1","Tea, Earl Grey, Hot");
      notes.put("notes_key_2","Tea, Earl Grey… decaf.");
      customerRequest.put("notes",notes);

      Customer customer = razorpay.customers.create(customerRequest);

      ```

      ```python Python theme={null}
      import razorpay
      client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

      client.customer.create({
          'name': '<name>',
          'email': '<email>',
          'contact': '<phone>',
          'fail_existing': "0",
          'notes': {'note_key_1': 'September', 'note_key_2': 'Make it so.'}
          })

      ```

      ```go Go theme={null}
      import ( razorpay "github.com/razorpay/razorpay-go" )
      client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

      data := map[string]interface{}{
          "name": "<name>",
          "contact": <phone>,
          "email": "<email>",
          "fail_existing": "0",
          "notes": map[string]interface{}{
              "notes_key_1": "Tea, Earl Grey, Hot",
              "notes_key_2": "Tea, Earl Grey… decaf.",
          },
      }
      body, err := client.Customer.Create(data, nil)

      ```

      ```php PHP theme={null}
      $api = new Api($key_id, $secret);

      $api->customer->create(array('name' => '<name>', 'email' => '<email>','contact'=>'<phone>','fail_existing' => "0", 'notes'=> array('notes_key_1'=> 'Tea, Earl Grey, Hot','notes_key_2'=> 'Tea, Earl Grey… decaf'));
      ```

      ```csharp .NET theme={null}
      RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

      Dictionary<string, object> options = new Dictionary<string,object>();

      options.Add("name", "<name>"); 
      options.Add("contact", "<phone>"); 
      options.Add("email", "<email>"); 
      options.Add("fail_existing", "0"); 

      Customer customer = Customer.Create(options);

      ```

      ```ruby Ruby theme={null}
      require "razorpay"
      Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

      para_attr = {
        "name": "<name>",
        "contact": "<phone>",
        "email": "<email>",
        "fail_existing": "0",
        "notes": {
          "notes_key_1": "Tea, Earl Grey, Hot",
          "notes_key_2": "Tea, Earl Grey… decaf."
        }
      }

      Razorpay::Customer.create(para_attr)

      ```

      ```javascript Node.js theme={null}
      var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

      instance.customers.create({
        name: "<name>",
        contact: "<phone>",
        email: "<email>",
        fail_existing: "0",
        notes: {
          notes_key_1: "Tea, Earl Grey, Hot",
          notes_key_2: "Tea, Earl Grey… decaf."
        }
      })
      ```

      ```json Response theme={null}
      {
        "id":"cust_1Aa00000000001",
        "entity":"customer",
        "name":"<name>",
        "email":"<email>",
        "contact":"<phone>",
        "gstin":null,
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "created_at ":1234567890
      }
      ```
    </Note>
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Request Parameters">
    `name`
    : `string` The name of the customer. For example, `Gaurav Kumar`.

    `email`
    : `string` The email address of the customer. For example, `gaurav.kumar@example.com`.

    `contact`
    : `string` The phone number of the customer. For example, `9876543210`.

    `fail_existing` *optional*
    : `string` The request throws an exception by default if a customer with the exact details already exists. You can pass an additional parameter `fail_existing` to get the existing customer's details in the response. Possible values:

    * `1` (default): If a customer with the same details already exists, throws an error.
    * `0`: If a customer with the same details already exists, fetches details of the existing customer.

    `notes` *optional*
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` The unique identifier of the customer. For example `cust_1Aa00000000001`.

    `entity`
    : `string` The name of the entity. Here, it is `customer`.

    `name`
    : `string` The name of the customer. For example, `Gaurav Kumar`.

    `email`
    : `string` The email address of the customer. For example, `gaurav.kumar@example.com`.

    `contact`
    : `string` The phone number of the customer. For example, `9876543210`.

    `notes`
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.

    `created_at`
    : `integer` A Unix timestamp, at which the customer was created.

    You can create an order once you create a customer for the payment authorisation.
  </Accordion>
</AccordionGroup>

### 1.1.2. Create an Order

Use the [Orders API](/docs/api/orders) to create a unique Razorpay `order_id` that is associated with the authorisation transaction. The following endpoint creates an order.

`POST /orders`

```bash Curl theme={null}
curl -u <YOUR_KEY_ID>:<YOUR_KEY_SECRET> \
-X POST https://api.razorpay.com/v1/orders \
-H "Content-Type: application/json" \
-d '{
   "amount":100,
   "currency":"INR",
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "method":"card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 2709971120,
    "frequency": "monthly"
  },
   "receipt":"Receipt No. 1",
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf."
   }
}'

```

```java Java theme={null}
RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

JSONObject orderRequest = new JSONObject();
orderRequest.put("amount", 100);
orderRequest.put("currency", "INR");
orderRequest.put("customer_id", "cust_4xbQrmEoA5WJ01");
orderRequest.put("method", "card");
JSONObject token = new JSONObject();
token.put("max_amount","100000000"); 
token.put("expire_at","2709971120");
token.put("frequency","monthly");
orderRequest.put("token", token);
orderRequest.put("receipt", "receipt#1");
JSONObject notes = new JSONObject();
notes.put("notes_key_1","Tea, Earl Grey, Hot");
notes.put("notes_key_2","Tea, Earl Grey… decaf.");
orderRequest.put("notes", notes);

Order order = razorpay.orders.create(orderRequest);

```

```php PHP theme={null}
$api = new Api($key_id, $secret);

$api->order->create(array('amount' => 100, 'currency' => 'INR',  'receipt' => '123', 'customer_id'=> $customerId, 'method'=>'card', 'token' => array('max_amount' => 100000000, 'expire_at' => 2709971120, 'frequency' => 'monthly'), 'notes'=> array('key1'=> 'value3','key2'=> 'value2')));

```

```javascript Node.js theme={null}
var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

instance.orders.create({
   "amount":100,
   "currency":"INR",
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "method":"card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt":"Receipt No. 1",
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf."
   }
})

```

```python Python theme={null}
client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

client.order.create({
    'amount': 50000,
    'currency': 'INR',
    'customer_id': 'cust_4xbQrmEoA5WJ01',
    'method': 'card',
    'token':{
      'max_amount': 100000000,
      'expire_at': 4102444799,
      'frequency': 'monthly'
   },
    'receipt': 'receipt#1',
    'notes': {'key1': 'value3', 'key2': 'value2'}
    })

```

```ruby Ruby theme={null}
require "razorpay"
Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

param_attr = {
   "amount":100,
   "currency": "INR",
   "customer_id": "cust_4xbQrmEoA5WJ01",
   "method": "card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt": "Receipt No. 1",
   "notes":{
      "notes_key_1": "Tea, Earl Grey, Hot",
      "notes_key_2": "Tea, Earl Grey... decaf."
   }
}

Razorpay::Order.create(para_attr)

```

```go Go theme={null}
import ( razorpay "github.com/razorpay/razorpay-go" )
client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

data := map[string]interface{}{
   "amount":100,
   "currency":"INR",
   "customer_id":"<customerId>",
   "method":"card",
   "token":map[string]interface{}{
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt":"Receipt No. 1",
   "notes":map[string]interface{}{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf.",
   },
}
body, err := client.Order.Create(data, nil)

```

```csharp .NET theme={null}
RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

Dictionary<string, object> orderRequest = new Dictionary<string, object>();
orderRequest.Add("amount", 100);
orderRequest.Add("currency", "INR");
orderRequest.Add("customer_id", "cust_Z6t7VFTb9xHeOs");
orderRequest.Add("method", "card");
Dictionary<string, object> token = new Dictionary<string, object>();
token.Add("max_amount", "5000");
token.Add("expire_at", "2709971120");
token.Add("frequency", "monthly");
orderRequest.Add("token", token);
orderRequest.Add("receipt", "receipt#176");
Dictionary<string, object> notes = new Dictionary<string, object>();
notes.Add("notes_key_1", "Tea, Earl Grey, Hot");
notes.Add("notes_key_2", "Tea, Earl Grey… decaf.");
orderRequest.Add("notes", notes);

Order order = client.Order.Create(orderRequest);
```

```json Response theme={null}
{
   "id":"order_1Aa00000000002",
   "entity":"order",
   "amount":100,
   "amount_paid":0,
   "amount_due":100,
   "currency":"INR",
   "receipt":"Receipt No. 1",
   "method":"card",
   "description":null,
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "offer_id":null,
   "status":"created",
   "attempts":0,
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey… decaf."
   },
   "created_at":1565172642
}
```

<AccordionGroup>
  <Accordion title="Request Parameters">
    `amount` *mandatory*
    : `integer` Amount in currency subunits. For cards, the amount should be `100`, that is, <currency MY="0.10" IN="1" SG="0.5" US="1" />.

    `currency` *mandatory*
    : `string` The 3-letter ISO currency code for the payment.

    `customer_id` *mandatory*
    : `string` The unique identifier of the customer. For example, `cust_4xbQrmEoA5WJ01`.

    `method` *optional*
    : `string` Payment method used to make the authorisation transaction. Here, it is `card`.

    `token`
    : `object` Details related to the authorisation such as max amount, frequency and expiry information.

    `max_amount` *mandatory*
    : `integer` The maximum amount that can be auto-debited in a single charge. The minimum value is `100`, that is, <currency MY="1" IN="1" SG="1" US="1" />, and the maximum value is `1500000`, that is, <currency MY="10000" IN="15000" SG="10000" US="10000" />. For an amount higher than this, the cardholder should provide an Additional Factor of Authentication (AFA) as per RBI guidelines.

    `expire_at` *mandatory*
    : `integer` The Unix timestamp that indicates when the authorisation transaction must expire. The card's expiry year is considered a default value.

    `frequency` *mandatory*
    : `string` The frequency at which you can charge your customer. Possible values:

    * `weekly`
    * `monthly`
    * `yearly`
    * `as_presented`

    `receipt` *optional*
    : `string` A user-entered unique identifier for the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `notes`*optional*
    : `object` Key-value pair you can use to store additional information about the entity. Maximum 15 key-value pairs, 256 characters each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` A unique identifier of the order created. For example `order_1Aa00000000002`.

    `entity`
    : `string` The entity that has been created. Here it is `order`.

    `amount`
    : `integer` Amount in currency subunits. For cards, the amount should be `100`, that is, <currency MY="0.10" IN="1" SG="0.5" US="1" />.

    `amount_paid`
    : `integer` The amount that has been paid.

    `amount_due`
    : `integer` The amount that is yet to pay.

    `currency`
    : `string` The 3-letter ISO currency code for the payment.

    `receipt`
    : `string` A user-entered unique identifier of the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `method`
    : `string` Payment method used to make the authorisation transaction. Here, it is `card`.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_4xbQrmEoA5WJ01`.

    `status`
    : `string` The status of the order.

    `notes`
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.

    `created_at`
    : `integer` The Unix timestamp at which the order was created.

    You can create a payment against the `order_id` after you create an order.
  </Accordion>
</AccordionGroup>

### 1.1.3. Create an Authorisation Payment

Create a payment checkout form for customers to make Authorisation Transaction and register their mandate. You can use the Handler Function or Callback URL.

| Handler Function                                                                                                                                                                                                                                  | Callback URL                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When you use the handler function, the response object of the successful payment (`razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`) is submitted to the Checkout Form. You need to collect these and send them to your server. | When you use a Callback URL, the response object of the successful payment (`razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`) is submitted to the Callback URL. |

<Warning>
  **Watch Out!**

  * The callback URL is not supported for recurring payments created using the registration link.
  * While handling the first time authorisation payment response, consume the `error_reason` field with value `upi_dummy_payment` and `error_description` field with value `Payment was a dummy payment for one time mandate registration.` to identify successful mandate registration. The parent `error_code` will be `BAD_REQUEST_ERROR`.
</Warning>

<Note>
  ```html Checkout with handler functions theme={null}
  <button id = "rzp-button1"> Pay </button>
    <script src = "https://checkout.razorpay.com/v1/checkout.js"> </script>
    <script>
      var options = {
        "key": "[YOUR_KEY_ID]",
        "order_id": "order_1Aa00000000001",
        "customer_id": "cust_1Aa00000000001",
        "recurring": true,
        "handler": function (response) {
          alert(response.razorpay_payment_id);
          alert(response.razorpay_order_id);
          alert(response.razorpay_signature);
        },
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "theme": {
          "color": "#F37254"
        }
      };
      var rzp1 = new Razorpay(options);
      document.getElementById('rzp-button1').onclick = function (e) {
        rzp1.open();
        e.preventDefault();
      }
    </script>
  ```

  ```html Manual checkout with Callback URL theme={null}
  <button id = "rzp-button1"> Pay </button>
    <script src = "https://checkout.razorpay.com/v1/checkout.js"> </script>
    <script>
      var options = {
        "key": "[YOUR_KEY_ID]",
        "order_id": "order_1Aa00000000001",
        "customer_id": "cust_1Aa00000000001",
        "recurring": true,
        "callback_url": "https://eneqd3r9zrjok.x.pipedream.net/",
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "theme": {
          "color": "#F37254"
        }
      };
      var rzp1 = new Razorpay(options);
      document.getElementById('rzp-button1').onclick = function (e) {
        rzp1.open();
        e.preventDefault();
      }
    </script>
  ```
</Note>

<AccordionGroup>
  <Accordion title="Additional Checkout Fields">
    You should send the following additional parameters along with the existing checkout options as a part of the authorisation transaction.

    `customer_id` *mandatory*
    : `string` Unique identifier of the customer created in the [first step](#111-create-a-customer).

    `order_id` *mandatory*
    : `string` Unique identifier of the  order created in the [second step](#112-create-an-order).

    `recurring` *mandatory*
    : `boolean` Possible values:

    * `true`: Recurring payment is enabled.
    * `false`: Recurring payment is not enabled.

    <Info>
      **Handy Tips**

      The `recurring` parameter also supports the value `preferred`. Use this when you want to support recurring payments and one-time payment in the same flow.
    </Info>
  </Accordion>
</AccordionGroup>

After this step, you can proceed to integrate with the [Fetch Token API](/docs/api/payments/recurring-payments/cards/tokens).

## 1.2. Using a Registration Link

Registration Link is an alternate way of creating an authorisation transaction. You can create a registration link using the API or [Dashboard](/docs/payments/recurring-payments/create#1-create-a-registration-link).

* You do not have to create a customer if you choose the registration link method for creating an authorisation transaction.

* When you create a registration link, an [invoice](/docs/payments/invoices) is automatically issued to the customer. They can use this invoice to make the authorisation payment.

* A registration link should always have an order amount (in subunits) the customer will be charged when making the authorisation payment. For cards, the amount should be <currency MY="0.10" IN="1" SG="0.5" US="1" /> in the case of cards.

<Info>
  **Handy Tips**

  You can [use Webhooks to get notifications about successful payments](/docs/api/payments/recurring-payments/webhooks#check-authorization-link-status-using-webhooks) against a registration link.
</Info>

### 1.2.1. Create a Registration Link

The following endpoint creates a registration link.

`POST /subscription_registration/auth_links`

```bash Curl theme={null}
curl -u <YOUR_KEY_ID>:<YOUR_KEY_SECRET>
-X POST https://api.razorpay.com/v1/subscription_registration/auth_links
-H "Content-Type: application/json" \
-d '{
  "customer":{
    "name":"<name>",
    "email":"<email>",
    "contact":"<phone>"
  },
  "type":"link",
  "amount":"100",
  "currency":"INR",
  "description":"Registration Link for <name>",
  "subscription_registration":{
    "method":"card",
    "max_amount":"1000000",
    "expire_at":1609423824,
    "frequency": "monthly"
  },
  "receipt":"Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1580479824,
  "notes":{
    "note_key 1":"Beam me up Scotty",
    "note_key 2":"Tea. Earl Gray. Hot."
  }
}'

```

```java Java theme={null}
RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

JSONObject registrationLinkRequest = new JSONObject();
JSONObject customer = new JSONObject();
customer.put("name","<name>");
customer.put("email","<email>");
customer.put("contact","<phone>");
registrationLinkRequest.put("customer", customer);
registrationLinkRequest.put("type", "link");
registrationLinkRequest.put("amount", 100);
registrationLinkRequest.put("currency", "INR");
registrationLinkRequest.put("description", "Registration Link for <name>");
JSONObject subscriptionRegistration = new JSONObject();
subscriptionRegistration.put("method","card");
subscriptionRegistration.put("max_amount",1000000);
subscriptionRegistration.put("expire_at",1609423824);
subscriptionRegistration.put("frequency","monthly");
registrationLinkRequest.put("subscription_registration", subscriptionRegistration);
registrationLinkRequest.put("receipt", "Receipt No. 1");
registrationLinkRequest.put("email_notify", true);
registrationLinkRequest.put("sms_notify", true);
registrationLinkRequest.put("expire_by", 1580479824);
JSONObject notes = new JSONObject();
notes.put("notes_key_1","Tea, Earl Grey, Hot");
notes.put("notes_key_2","Tea, Earl Grey… decaf.");
registrationLinkRequest.put("notes", notes);

Invoice invoice = razorpay.invoices.createRegistrationLink(registrationLinkRequest);

```

```php PHP theme={null}
$api = new Api($key_id, $secret);

$api->subscription->createSubscriptionRegistration(array('customer'=>array('name'=>'<name>','email'=>'<email>','contact'=>'<phone>'),'type'=>'link','amount'=>100,'currency'=>'INR','description'=>'Registration Link for <name>','subscription_registration'=>array('method'=>'card','max_amount'=>'1000000','expire_at'=>'1634215992','frequency'=>'monthly'),'receipt'=>'Receipt No. 5','email_notify'=> true,'sms_notify'=>true,'expire_by'=>1634215992, 'notes'=> array('note_key 1'=> 'Beam me up Scotty','note_key 2'=> 'Tea. Earl Gray. Hot.')));
```

```javascript Node.js theme={null}
var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

instance.subscriptions.createRegistrationLink({
  customer: {
    name: "<name>",
    email: "<email>",
    contact: "<phone>"
  },
  type: "link",
  amount: 100,
  currency: "INR",
  description: "Registration Link for <name>",
  subscription_registration: {
    method: "card",
    max_amount: 1000000,
    expire_at: 1609423824,
    frequency: "monthly"
  },
  receipt: "Receipt No. 1",
  email_notify: true,
  sms_notify: true,
  expire_by: 1580479824,
  notes: {
    notes_key_1: "Tea, Earl Grey, Hot",
    notes_key_2: "Tea, Earl Grey... decaf."
  }
})
```

```python Python theme={null}
client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

client.registration_link.create({
    'customer': {'name': '<name>',
                 'email': '<email>',
                 'contact': '<phone>'},
    'type': 'link',
    'amount': '100',
    'currency': 'INR',
    'description': 'Registration Link for Gaurav',
    'subscription_registration': {'method': 'card', 'max_amount': '1000000'
                                  , 'expire_at': 1644737663, 'frequency': 'monthly'},
    'receipt': 'Receipt No. #11',
    'email_notify': True,
    'sms_notify': True,
    'expire_by': 1644737663,
    'notes': {'note_key 1': 'Beam me up Scotty',
              'note_key 2': 'Tea. Earl Gray. Hot.'}
    })

```

```ruby Ruby theme={null}
require "razorpay"
Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

para_attr = {
  "customer":{
    "name": "<name>",
    "email": "<email>",
    "contact": "<phone>"
  },
  "type": "link",
  "amount": "100",
  "currency": "INR",
  "description": "Registration Link for <name>",
  "subscription_registration":{
    "method": "card",
    "max_amount": "1000000",
    "expire_at": 1609423824,
    "frequency": "monthly"
  },
  "receipt": "Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1580479824,
  "notes":{
    "note_key 1": "Beam me up Scotty",
    "note_key 2": "Tea. Earl Gray. Hot."
  }
}

Razorpay::SubscriptionRegistration.create(para_attr)

```

```go Go theme={null}
import ( razorpay "github.com/razorpay/razorpay-go" )
client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

data:= map[string]interface{}{
  "customer":map[string]interface{}{
    "name":"<name>",
    "email":"<email>",
    "contact":"<phone>",
  },
  "type":"link",
  "amount":"100",
  "currency":"INR",
  "description":"Registration Link for <name>",
  "subscription_registration":map[string]interface{}{
    "method":"card",
    "max_amount":"1000000",
    "expire_at":1609423824,
    "frequency": "monthly"
  },
  "receipt":"Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1681987284,
  "notes":map[string]interface{}{
    "note_key 1":"Beam me up Scotty",
    "note_key 2":"Tea. Earl Gray. Hot.",
  },
}

body, err := client.Invoice.CreateRegistrationLink(data, nil)

```

```csharp .NET theme={null}
RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

Dictionary<string, object> registrationLinkRequest = new Dictionary<string, object>();
Dictionary<string, object> customer = new Dictionary<string, object>();
customer.Add("name", "<name>");
customer.Add("email", "<email>");
customer.Add("contact", "<phone>");
registrationLinkRequest.Add("customer", customer);
registrationLinkRequest.Add("type", "link");
registrationLinkRequest.Add("amount", 100);
registrationLinkRequest.Add("currency", "INR");
registrationLinkRequest.Add("description", "Registration Link for <name>");
Dictionary<string, object> subscriptionRegistration = new Dictionary<string, object>();
subscriptionRegistration.Add("method", "card");
subscriptionRegistration.Add("max_amount", 1000000);
subscriptionRegistration.Add("expire_at", 1609423824);
registrationLinkRequest.Add("subscription_registration", subscriptionRegistration);
registrationLinkRequest.Add("receipt", "Receipt No. #18d");
registrationLinkRequest.Add("email_notify", true);
registrationLinkRequest.Add("sms_notify", true);
registrationLinkRequest.Add("expire_by", 1580479824);
Dictionary<string, object> notes = new Dictionary<string, object>();
notes.Add("notes_key_1", "Tea, Earl Grey, Hot");
notes.Add("notes_key_2", "Tea, Earl Grey… decaf.");
registrationLinkRequest.Add("notes", notes);

Invoice invoice = client.Invoice.CreateRegistrationLink(registrationLinkRequest);
```

```json Response theme={null}
{
  "id": "inv_FHrXGIpd3N17DX",
  "entity": "invoice",
  "receipt": "Receipt No. 24",
  "invoice_number": "Receipt No. 24",
  "customer_id": "cust_BMB3EwbqnqZ2EI",
  "customer_details": {
    "id": "cust_BMB3EwbqnqZ2EI",
    "name": "<name>",
    "email": "<email>",
    "contact": "<phone>",
    "gstin": null,
    "billing_address": null,
    "shipping_address": null,
    "customer_name": "<name>",
    "customer_email": "<email>",
    "customer_contact": "<phone>"
  },
  "order_id": "order_FHrXGJNngJyEAe",
  "line_items": [],
  "payment_id": null,
  "status": "issued",
  "expire_by": 4102444799,
  "issued_at": 1595491014,
  "paid_at": null,
  "cancelled_at": null,
  "expired_at": null,
  "sms_status": "pending",
  "email_status": "pending",
  "date": 1595491014,
  "terms": null,
  "partial_payment": false,
  "gross_amount": 100,
  "tax_amount": 0,
  "taxable_amount": 0,
  "amount": 100,
  "amount_paid": 0,
  "amount_due": 100,
  "currency": "INR",
  "currency_symbol": "₹",
  "description": "Registration Link for <name>",
  "notes": {
    "note_key 1": "Beam me up Scotty",
    "note_key 2": "Tea. Earl Gray. Hot."
  },
  "comment": null,
  "short_url": "https://rzp.io/i/VSriCfn",
  "view_less": true,
  "billing_start": null,
  "billing_end": null,
  "type": "link",
  "group_taxes_discounts": false,
  "created_at": 1595491014,
  "idempotency_key": null
}
```

<AccordionGroup>
  <Accordion title="Request Parameters">
    `customer`
    : `object` Details of the customer to whom the registration link is sent.

    `name` *mandatory*
    : `string` Customer's name.

    `email` *mandatory*
    : `string` Customer's email address.

    `contact`*mandatory*
    : `integer` Customer's contact number.

    `type` *mandatory*
    : `string` In this case, the value is `link`.

    `amount` *mandatory*
    : `integer` The payment amount in the smallest currency sub-unit.

    `currency` *mandatory*
    : `string` The 3-letter ISO currency code for the payment.

    `description` *mandatory*
    : `string` A description that appears on the hosted page.

    `subscription_registration`
    : `object` Details of the authorisation transaction.

    `method` *mandatory*
    : `string` The authorisation method. Here it is `card`.

    `max_amount` *mandatory*
    : `integer` The maximum amount that can be auto-debited in a single charge. The minimum value is `100` (₹1) and the maximum value is `100000000` (₹10,00,000). For an amount higher than this or the RBI limit of ₹15,000 (`1500000`) or ₹1,00,000 (`10000000`) respectively, the cardholder should provide an Additional Factor of Authentication (AFA) as per RBI guidelines.

    `expire_at` *optional*
    : `integer` The Unix timestamp till when you can use the token (authorisation on the payment method) to charge the customer subsequent payments. The card's expiry year is considered a default value.

    `frequency` *mandatory*
    : `string` The frequency at which you can charge your customer. Possible values:

    * `weekly`
    * `monthly`
    * `yearly`
    * `as_presented`

    `sms_notify` *optional*
    : `boolean` Indicates if SMS notifications are to be sent by Razorpay. Possible values:

    * `true` (default): Notifications are sent by Razorpay .
    * `false`: Notifications are not sent by Razorpay.

    `email_notify` *optional*
    : `boolean` Indicates if email notifications are to be sent by Razorpay. Possible values:

    * `true` (default): Notifications are sent by Razorpay .
    * `false`: Notifications are not sent by Razorpay.

    `expire_by` *optional*
    : `integer` The Unix timestamp indicates the expiry of the registration link.

    `receipt` *optional*
    : `string` A unique identifier entered by you for the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `notes` *optional*
    : `object` This is a key-value pair that is used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` The unique identifier of the invoice.

    `entity`
    : `string` The entity that has been created. Here, it is `invoice`.

    `receipt`
    : `string` A user-entered unique identifier of the invoice.

    `invoice_number`
    : `string` Unique number you added for internal reference.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_BMB3EwbqnqZ2EI`.

    `customer_details`
    : `object` Details of the customer.

    `id`
    : `string` The unique identifier associated with the customer to whom the invoice has been issued.

    `name`
    : `string` The customer's name.

    `email`
    : `string` The customer's email address.

    `contact`
    : `integer` The customer's phone number.

    `billing_address`
    : `string` Details of the customer's billing address.

    `shipping_address`
    : `string` Details of the customer's shipping address.

    `order_id`
    : `string` The unique identifier of the order associated with the invoice.

    `line_items`
    : `string` Details of the line item that is billed in the invoice. Maximum of 50 line items are allowed.

    `payment_id`
    : `string` Unique identifier of a payment made against the invoice.

    `status`
    : `string` The status of the invoice. Possible values:

    * `draft`
    * `issued`
    * `partially_paid`
    * `paid`
    * `cancelled`
    * `expired`
    * `deleted`

    `expire_by`
    : `integer` The Unix timestamp at which the invoice will expire.

    `issued_at`
    : `integer` The Unix timestamp at which the invoice was issued to the customer.

    `paid_at`
    : `integer` The Unix timestamp at which the payment was made.

    `cancelled_at`
    : `integer` The Unix timestamp at which the invoice was cancelled.

    `expired_at`
    : `integer` The Unix timestamp at which the invoice expired.

    `sms_status`
    : `string` The delivery status of the SMS notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `email_status`
    : `string` The delivery status of the email notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `date`
    : `integer` Timestamp, in Unix format, that indicates the issue date of the invoice.

    `terms`
    : `string` Any terms to be included in the invoice. Maximum of 2048 characters.

    `partial_payment`
    : `boolean` Indicates whether the customer can make a partial payment on the invoice. Possible values:

    * `true`:  The customer can make partial payments.
    * `false` (default): The customer cannot make partial payments.

    `amount`
    : `integer` Amount to be paid using the invoice. Must be in the smallest unit of the currency. For example, if the amount to be received from the customer is <currency MY="299.95" IN="299.95" SG="299.95" US="299.95" />, pass the value as `29995`.

    `amount_paid`
    : `integer` Amount paid by the customer against the invoice.

    `amount_due`
    : `integer` The remaining amount to be paid by the customer for the issued invoice.

    `currency`
    : `string` The currency associated with the invoice.

    `description`
    : `string`  A brief description of the invoice.

    `notes`
    : `object` Any custom notes added to the invoice. Maximum of 2048 characters.

    `short_url`
    : `string` The short URL that is generated. This is the link that can be shared with the customer to receive payments.

    `type`
    : `string` Here, it is `invoice`.

    `comment`
    : `string` Any comments to be added in the invoice. Maximum of 2048 characters.
  </Accordion>
</AccordionGroup>

### 1.2.2. Send/Resend Notifications

The following endpoint sends/resends notifications with the short URL to the customer:

`POST /invoices/:id/notify_by/:medium`

<AccordionGroup>
  <Accordion title="Sample Code">
    ```bash Curl theme={null}
     curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET]
     -X POST https://api.razorpay.com/v1/invoices/inv_1Aa00000000001/notify_by/sms

    ```

    ```java Java theme={null}
    RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    String invoiceId = "inv_1Aa00000000001";

    String medium = "sms";

    Invoice invoice = razorpay.invoices.notifyBy(invoiceId, medium);

    ```

    ```php PHP theme={null}
    $api = new Api($key_id, $secret);

    $api->invoice->fetch($invoiceId)->notify($medium);

    ```

    ```javascript Node.js theme={null}
    var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

    instance.invoices.notifyBy(invoiceId, medium)


    ```

    ```python Python theme={null}
    client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

    client.invoice.notify_by(invoiceId, medium)

    ```

    ```ruby Ruby theme={null}
    require "razorpay"
    Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

    invoiceId = "inv_JDdNb4xdf4gxQ7"

    medium = "email" 

    Razorpay::Invoice.notify_by(invoiceId, medium)

    ```

    ```go Go theme={null}
    import ( razorpay "github.com/razorpay/razorpay-go" )
    client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

    body, err := client.Invoice.Notify("<invoiceId>", "<medium>", nil, nil)

    ```

    ```csharp .NET theme={null}
    RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    string invoiceId = "inv_Z6t7VFTb9xHeOs";

    string medium = "sms";

    Invoice invoice = client.Invoice.Fetch(invoiceId).NotifyBy(medium);
    ```

    ```json Response theme={null}
    {
      "success": true
    }
    ```
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Path Parameters">
    `id`*mandatory*
    : `string` The unique identifier of the invoice linked to the registration link for which you want to send the notification. For example, `inv_1Aa00000000001`.

    `medium` *mandatory*
    : `string` Determines through which medium you want to resend the notification. Possible values:

    * `sms`
    * `email`
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameter">
    `success`
    : `boolean` Indicates whether the notifications were sent successfully. Possible values:

    * `true`: The notifications were successfully sent via SMS, email or both.
    * `false`: The notifications were not sent.
  </Accordion>
</AccordionGroup>

### 1.2.3. Cancel a Registration Link

The following endpoint cancels a registration link.

`POST /invoices/:id/cancel`

<Info>
  **Handy Tips**

  You can only cancel registration link in the `issued` state.
</Info>

<AccordionGroup>
  <Accordion title="Sample Code">
    ```bash Curl theme={null}
     curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET]
     -X POST https://api.razorpay.com/v1/invoices/inv_1Aa00000000001/cancel

    ```

    ```java Java theme={null}
    RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    String invoiceId = "inv_1Aa00000000001";

    Invoice invoice = razorpay.invoices.cancel(invoiceId);

    ```

    ```php PHP theme={null}
    $api = new Api($key_id, $secret);

    $api->invoice->fetch($invoiceId)->cancel();
    ```

    ```javascript Node.js theme={null}
    var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

    instance.invoices.cancel(invoiceId)

    ```

    ```python Python theme={null}
    client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

    client.invoice.cancel(invoiceId)

    ```

    ```ruby Ruby theme={null}
    require "razorpay"
    Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

    invoiceId = "inv_1Aa00000000001"

    Razorpay::Invoice.cancel(invoiceId)

    ```

    ```go Go theme={null}
    import ( razorpay "github.com/razorpay/razorpay-go" )
    client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

    body, err := client.Invoice.Cancel("<invoiceId>", nil, nil)

    ```

    ```csharp .NET theme={null}
    RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    string invoiceId = "inv_Z6t7VFTb9xHeOs";

    Invoice invoice = client.Invoice.Fetch(invoiceId).Cancel();
    ```

    ```json Response theme={null}
    {
      "id": "inv_FHrfRupD2ouKIt",
      "entity": "invoice",
      "receipt": "Receipt No. 1",
      "invoice_number": "Receipt No. 1",
      "customer_id": "cust_BMB3EwbqnqZ2EI",
      "customer_details": {
          "id": "cust_BMB3EwbqnqZ2EI",
          "name": "<name>",
          "email": "<email>",
          "contact": "<phone>",
          "gstin": null,
          "billing_address": null,
          "shipping_address": null,
          "customer_name": "<name>",
          "customer_email": "<email>",
          "customer_contact": "<phone>"
      },
      "order_id": "order_FHrfRw4TZU5Q2L",
      "line_items": [],
      "payment_id": null,
      "status": "cancelled",
      "expire_by": 4102444799,
      "issued_at": 1595491479,
      "paid_at": null,
      "cancelled_at": 1595491488,
      "expired_at": null,
      "sms_status": "sent",
      "email_status": "sent",
      "date": 1595491479,
      "terms": null,
      "partial_payment": false,
      "gross_amount": 100,
      "tax_amount": 0,
      "taxable_amount": 0,
      "amount": 100,
      "amount_paid": 0,
      "amount_due": 100,
      "currency": "INR",
      "currency_symbol": "₹",
      "description": "Registration Link for Gaurav Kumar",
      "notes": {
          "note_key 1": "Beam me up Scotty",
          "note_key 2": "Tea. Earl Gray. Hot."
      },
      "comment": null,
      "short_url": "https://rzp.io/i/QlfexTj",
      "view_less": true,
      "billing_start": null,
      "billing_end": null,
      "type": "link",
      "group_taxes_discounts": false,
      "created_at": 1595491480,
      "idempotency_key": null
    }

    ```
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Path Parameter">
    `id` *mandatory*
    : `string` The unique identifier for the invoice linked to the registration link that you want to cancel. For example, `inv_1Aa00000000001`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameter">
    `id`
    : `string` The unique identifier of the invoice.

    `entity`
    : `string` The entity that has been created. Here, it is `invoice`.

    `receipt`
    : `string` A user-entered unique identifier of the invoice.

    `invoice_number`
    : `string` Unique number you added for internal reference.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_BMB3EwbqnqZ2EI`.

    `customer_details`
    : `object` Details of the customer.

    `id`
    : `string` The unique identifier associated with the customer to whom the invoice has been issued.

    `name`
    : `string` The customer's name.

    `email`
    : `string` The customer's email address.

    `contact`
    : `integer` The customer's phone number.

    `billing_address`
    : `string` Details of the customer's billing address.

    `shipping_address`
    : `string` Details of the customer's shipping address.

    `order_id`
    : `string` The unique identifier of the order associated with the invoice.

    `line_items`
    : `string` Details of the line item that is billed in the invoice. Maximum of 50 line items are allowed.

    `payment_id`
    : `string` Unique identifier of a payment made against the invoice.

    `status`
    : `string` The status of the invoice. Possible values:

    * `draft`
    * `issued`
    * `partially_paid`
    * `paid`
    * `cancelled`
    * `expired`
    * `deleted`

    `expire_by`
    : `integer` The Unix timestamp at which the invoice will expire.

    `issued_at`
    : `integer` The Unix timestamp at which the invoice was issued to the customer.

    `paid_at`
    : `integer` The Unix timestamp at which the payment was made.

    `cancelled_at`
    : `integer` The Unix timestamp at which the invoice was cancelled.

    `expired_at`
    : `integer` The Unix timestamp at which the invoice expired.

    `sms_status`
    : `string` The delivery status of the SMS notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `email_status`
    : `string` The delivery status of the email notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `date`
    : `integer` Timestamp, in Unix format, that indicates the issue date of the invoice.

    `terms`
    : `string` Any terms to be included in the invoice. Maximum of 2048 characters.

    `partial_payment`
    : `boolean` Indicates whether the customer can make a partial payment on the invoice. Possible values:

    * `true`:  The customer can make partial payments.
    * `false` (default): The customer cannot make partial payments.

    `amount`
    : `integer` Amount to be paid using the invoice. Must be in the smallest unit of the currency. For example, if the amount to be received from the customer is <currency MY="299.95" IN="299.95" SG="299.95" US="299.95" />, pass the value as `29995`.

    `amount_paid`
    : `integer` Amount paid by the customer against the invoice.

    `amount_due`
    : `integer` The remaining amount to be paid by the customer for the issued invoice.

    `currency`
    : `string` The currency associated with the invoice.

    `description`
    : `string`  A brief description of the invoice.

    `notes`
    : `object` Any custom notes added to the invoice. Maximum of 2048 characters.

    `short_url`
    : `string` The short URL that is generated. This is the link that can be shared with the customer to receive payments.

    `type`
    : `string` Here, it is `invoice`.

    `comment`
    : `string` Any comments to be added in the invoice. Maximum of 2048 characters.
  </Accordion>
</AccordionGroup>

After this step, you can proceed to integrate with the [Fetch Token API](/docs/api/payments/recurring-payments/cards/tokens).
----

> ## Documentation Index
> Fetch the complete documentation index at: https://razorpay-881012b3.mintlify.site/llms.txt
> Use this file to discover all available pages before exploring further.

# 1. Create the Authorisation Transaction

> Create an authorisation transaction for cards using Razorpay APIs.

<div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"0.35rem 0.9rem",border:"1px solid rgba(128,128,128,0.28)",borderRadius:"0.5rem",padding:"0.45rem 0.75rem",margin:"0 0 1.25rem",fontSize:"0.875rem"}}>
  <span style={{fontWeight:600}}>Available in</span>
  <span>🇮🇳 India</span>
</div>

You can create an authorisation transaction using [Razorpay APIs](#11-using-razorpay-apis) or [Registration Link](#12-using-a-registration-link).

<Warning>
  **Watch Out!**

  Bank downtime can affect success rates when processing recurring payments via debit cards.
</Warning>

## 1.1. Using Razorpay APIs

To create an authorisation transaction using Razorpay APIs, you need to:

1. [Create a Customer](#111-create-a-customer).
2. [Create an Order](#112-create-an-order).
3. [Create Authorisation Payment using Razorpay APIs](#113-create-an-authorisation-payment).

<Info>
  **Handy Tips**

  For the Authorisation Payment to be successful in a day (for example, 5th June), you should create an Order and the Authorisation Transaction on the same day (5th June) before 11:59 pm.
</Info>

### 1.1.1. Create a Customer

Razorpay links recurring tokens to customers using a unique identifier generated through the Customer API.

You can create [customers](/docs/api/customers) with basic information such as `email` and `contact` and use them for various Razorpay offerings. The following endpoint creates a customer.

`POST /customers`

<AccordionGroup>
  <Accordion title="Sample Code">
    <Note>
      ```bash Curl theme={null}
      curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET] \
      -X POST https://api.razorpay.com/v1/customers \
      -H "Content-Type: application/json" \
      -d '{
        "name": "<name>",
        "email": "<email>",
        "contact": "<phone>",
        "fail_existing": "0",
        "notes":{
          "note_key_1": "September",
          "note_key_2": "Make it so."
        }
      }'

      ```

      ```java Java theme={null}
      RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

      JSONObject customerRequest = new JSONObject();
      customerRequest.put("name","<name>");
      customerRequest.put("contact","<phone>");
      customerRequest.put("email","<email>");
      customerRequest.put("fail_existing", "0");
      JSONObject notes = new JSONObject();
      notes.put("notes_key_1","Tea, Earl Grey, Hot");
      notes.put("notes_key_2","Tea, Earl Grey… decaf.");
      customerRequest.put("notes",notes);

      Customer customer = razorpay.customers.create(customerRequest);

      ```

      ```python Python theme={null}
      import razorpay
      client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

      client.customer.create({
          'name': '<name>',
          'email': '<email>',
          'contact': '<phone>',
          'fail_existing': "0",
          'notes': {'note_key_1': 'September', 'note_key_2': 'Make it so.'}
          })

      ```

      ```go Go theme={null}
      import ( razorpay "github.com/razorpay/razorpay-go" )
      client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

      data := map[string]interface{}{
          "name": "<name>",
          "contact": <phone>,
          "email": "<email>",
          "fail_existing": "0",
          "notes": map[string]interface{}{
              "notes_key_1": "Tea, Earl Grey, Hot",
              "notes_key_2": "Tea, Earl Grey… decaf.",
          },
      }
      body, err := client.Customer.Create(data, nil)

      ```

      ```php PHP theme={null}
      $api = new Api($key_id, $secret);

      $api->customer->create(array('name' => '<name>', 'email' => '<email>','contact'=>'<phone>','fail_existing' => "0", 'notes'=> array('notes_key_1'=> 'Tea, Earl Grey, Hot','notes_key_2'=> 'Tea, Earl Grey… decaf'));
      ```

      ```csharp .NET theme={null}
      RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

      Dictionary<string, object> options = new Dictionary<string,object>();

      options.Add("name", "<name>"); 
      options.Add("contact", "<phone>"); 
      options.Add("email", "<email>"); 
      options.Add("fail_existing", "0"); 

      Customer customer = Customer.Create(options);

      ```

      ```ruby Ruby theme={null}
      require "razorpay"
      Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

      para_attr = {
        "name": "<name>",
        "contact": "<phone>",
        "email": "<email>",
        "fail_existing": "0",
        "notes": {
          "notes_key_1": "Tea, Earl Grey, Hot",
          "notes_key_2": "Tea, Earl Grey… decaf."
        }
      }

      Razorpay::Customer.create(para_attr)

      ```

      ```javascript Node.js theme={null}
      var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

      instance.customers.create({
        name: "<name>",
        contact: "<phone>",
        email: "<email>",
        fail_existing: "0",
        notes: {
          notes_key_1: "Tea, Earl Grey, Hot",
          notes_key_2: "Tea, Earl Grey… decaf."
        }
      })
      ```

      ```json Response theme={null}
      {
        "id":"cust_1Aa00000000001",
        "entity":"customer",
        "name":"<name>",
        "email":"<email>",
        "contact":"<phone>",
        "gstin":null,
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "created_at ":1234567890
      }
      ```
    </Note>
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Request Parameters">
    `name`
    : `string` The name of the customer. For example, `Gaurav Kumar`.

    `email`
    : `string` The email address of the customer. For example, `gaurav.kumar@example.com`.

    `contact`
    : `string` The phone number of the customer. For example, `9876543210`.

    `fail_existing` *optional*
    : `string` The request throws an exception by default if a customer with the exact details already exists. You can pass an additional parameter `fail_existing` to get the existing customer's details in the response. Possible values:

    * `1` (default): If a customer with the same details already exists, throws an error.
    * `0`: If a customer with the same details already exists, fetches details of the existing customer.

    `notes` *optional*
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` The unique identifier of the customer. For example `cust_1Aa00000000001`.

    `entity`
    : `string` The name of the entity. Here, it is `customer`.

    `name`
    : `string` The name of the customer. For example, `Gaurav Kumar`.

    `email`
    : `string` The email address of the customer. For example, `gaurav.kumar@example.com`.

    `contact`
    : `string` The phone number of the customer. For example, `9876543210`.

    `notes`
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.

    `created_at`
    : `integer` A Unix timestamp, at which the customer was created.

    You can create an order once you create a customer for the payment authorisation.
  </Accordion>
</AccordionGroup>

### 1.1.2. Create an Order

Use the [Orders API](/docs/api/orders) to create a unique Razorpay `order_id` that is associated with the authorisation transaction. The following endpoint creates an order.

`POST /orders`

```bash Curl theme={null}
curl -u <YOUR_KEY_ID>:<YOUR_KEY_SECRET> \
-X POST https://api.razorpay.com/v1/orders \
-H "Content-Type: application/json" \
-d '{
   "amount":100,
   "currency":"INR",
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "method":"card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 2709971120,
    "frequency": "monthly"
  },
   "receipt":"Receipt No. 1",
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf."
   }
}'

```

```java Java theme={null}
RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

JSONObject orderRequest = new JSONObject();
orderRequest.put("amount", 100);
orderRequest.put("currency", "INR");
orderRequest.put("customer_id", "cust_4xbQrmEoA5WJ01");
orderRequest.put("method", "card");
JSONObject token = new JSONObject();
token.put("max_amount","100000000"); 
token.put("expire_at","2709971120");
token.put("frequency","monthly");
orderRequest.put("token", token);
orderRequest.put("receipt", "receipt#1");
JSONObject notes = new JSONObject();
notes.put("notes_key_1","Tea, Earl Grey, Hot");
notes.put("notes_key_2","Tea, Earl Grey… decaf.");
orderRequest.put("notes", notes);

Order order = razorpay.orders.create(orderRequest);

```

```php PHP theme={null}
$api = new Api($key_id, $secret);

$api->order->create(array('amount' => 100, 'currency' => 'INR',  'receipt' => '123', 'customer_id'=> $customerId, 'method'=>'card', 'token' => array('max_amount' => 100000000, 'expire_at' => 2709971120, 'frequency' => 'monthly'), 'notes'=> array('key1'=> 'value3','key2'=> 'value2')));

```

```javascript Node.js theme={null}
var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

instance.orders.create({
   "amount":100,
   "currency":"INR",
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "method":"card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt":"Receipt No. 1",
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf."
   }
})

```

```python Python theme={null}
client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

client.order.create({
    'amount': 50000,
    'currency': 'INR',
    'customer_id': 'cust_4xbQrmEoA5WJ01',
    'method': 'card',
    'token':{
      'max_amount': 100000000,
      'expire_at': 4102444799,
      'frequency': 'monthly'
   },
    'receipt': 'receipt#1',
    'notes': {'key1': 'value3', 'key2': 'value2'}
    })

```

```ruby Ruby theme={null}
require "razorpay"
Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

param_attr = {
   "amount":100,
   "currency": "INR",
   "customer_id": "cust_4xbQrmEoA5WJ01",
   "method": "card",
   "token": {
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt": "Receipt No. 1",
   "notes":{
      "notes_key_1": "Tea, Earl Grey, Hot",
      "notes_key_2": "Tea, Earl Grey... decaf."
   }
}

Razorpay::Order.create(para_attr)

```

```go Go theme={null}
import ( razorpay "github.com/razorpay/razorpay-go" )
client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

data := map[string]interface{}{
   "amount":100,
   "currency":"INR",
   "customer_id":"<customerId>",
   "method":"card",
   "token":map[string]interface{}{
    "max_amount": 1000000,
    "expire_at": 4102444799,
    "frequency": "monthly"
   },
   "receipt":"Receipt No. 1",
   "notes":map[string]interface{}{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey... decaf.",
   },
}
body, err := client.Order.Create(data, nil)

```

```csharp .NET theme={null}
RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

Dictionary<string, object> orderRequest = new Dictionary<string, object>();
orderRequest.Add("amount", 100);
orderRequest.Add("currency", "INR");
orderRequest.Add("customer_id", "cust_Z6t7VFTb9xHeOs");
orderRequest.Add("method", "card");
Dictionary<string, object> token = new Dictionary<string, object>();
token.Add("max_amount", "5000");
token.Add("expire_at", "2709971120");
token.Add("frequency", "monthly");
orderRequest.Add("token", token);
orderRequest.Add("receipt", "receipt#176");
Dictionary<string, object> notes = new Dictionary<string, object>();
notes.Add("notes_key_1", "Tea, Earl Grey, Hot");
notes.Add("notes_key_2", "Tea, Earl Grey… decaf.");
orderRequest.Add("notes", notes);

Order order = client.Order.Create(orderRequest);
```

```json Response theme={null}
{
   "id":"order_1Aa00000000002",
   "entity":"order",
   "amount":100,
   "amount_paid":0,
   "amount_due":100,
   "currency":"INR",
   "receipt":"Receipt No. 1",
   "method":"card",
   "description":null,
   "customer_id":"cust_4xbQrmEoA5WJ01",
   "offer_id":null,
   "status":"created",
   "attempts":0,
   "notes":{
      "notes_key_1":"Tea, Earl Grey, Hot",
      "notes_key_2":"Tea, Earl Grey… decaf."
   },
   "created_at":1565172642
}
```

<AccordionGroup>
  <Accordion title="Request Parameters">
    `amount` *mandatory*
    : `integer` Amount in currency subunits. For cards, the amount should be `100`, that is, <currency MY="0.10" IN="1" SG="0.5" US="1" />.

    `currency` *mandatory*
    : `string` The 3-letter ISO currency code for the payment.

    `customer_id` *mandatory*
    : `string` The unique identifier of the customer. For example, `cust_4xbQrmEoA5WJ01`.

    `method` *optional*
    : `string` Payment method used to make the authorisation transaction. Here, it is `card`.

    `token`
    : `object` Details related to the authorisation such as max amount, frequency and expiry information.

    `max_amount` *mandatory*
    : `integer` The maximum amount that can be auto-debited in a single charge. The minimum value is `100`, that is, <currency MY="1" IN="1" SG="1" US="1" />, and the maximum value is `1500000`, that is, <currency MY="10000" IN="15000" SG="10000" US="10000" />. For an amount higher than this, the cardholder should provide an Additional Factor of Authentication (AFA) as per RBI guidelines.

    `expire_at` *mandatory*
    : `integer` The Unix timestamp that indicates when the authorisation transaction must expire. The card's expiry year is considered a default value.

    `frequency` *mandatory*
    : `string` The frequency at which you can charge your customer. Possible values:

    * `weekly`
    * `monthly`
    * `yearly`
    * `as_presented`

    `receipt` *optional*
    : `string` A user-entered unique identifier for the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `notes`*optional*
    : `object` Key-value pair you can use to store additional information about the entity. Maximum 15 key-value pairs, 256 characters each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` A unique identifier of the order created. For example `order_1Aa00000000002`.

    `entity`
    : `string` The entity that has been created. Here it is `order`.

    `amount`
    : `integer` Amount in currency subunits. For cards, the amount should be `100`, that is, <currency MY="0.10" IN="1" SG="0.5" US="1" />.

    `amount_paid`
    : `integer` The amount that has been paid.

    `amount_due`
    : `integer` The amount that is yet to pay.

    `currency`
    : `string` The 3-letter ISO currency code for the payment.

    `receipt`
    : `string` A user-entered unique identifier of the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `method`
    : `string` Payment method used to make the authorisation transaction. Here, it is `card`.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_4xbQrmEoA5WJ01`.

    `status`
    : `string` The status of the order.

    `notes`
    : `object` Key-value pair that can be used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.

    `created_at`
    : `integer` The Unix timestamp at which the order was created.

    You can create a payment against the `order_id` after you create an order.
  </Accordion>
</AccordionGroup>

### 1.1.3. Create an Authorisation Payment

Create a payment checkout form for customers to make Authorisation Transaction and register their mandate. You can use the Handler Function or Callback URL.

| Handler Function                                                                                                                                                                                                                                  | Callback URL                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When you use the handler function, the response object of the successful payment (`razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`) is submitted to the Checkout Form. You need to collect these and send them to your server. | When you use a Callback URL, the response object of the successful payment (`razorpay_payment_id`, `razorpay_order_id` and `razorpay_signature`) is submitted to the Callback URL. |

<Warning>
  **Watch Out!**

  * The callback URL is not supported for recurring payments created using the registration link.
  * While handling the first time authorisation payment response, consume the `error_reason` field with value `upi_dummy_payment` and `error_description` field with value `Payment was a dummy payment for one time mandate registration.` to identify successful mandate registration. The parent `error_code` will be `BAD_REQUEST_ERROR`.
</Warning>

<Note>
  ```html Checkout with handler functions theme={null}
  <button id = "rzp-button1"> Pay </button>
    <script src = "https://checkout.razorpay.com/v1/checkout.js"> </script>
    <script>
      var options = {
        "key": "[YOUR_KEY_ID]",
        "order_id": "order_1Aa00000000001",
        "customer_id": "cust_1Aa00000000001",
        "recurring": true,
        "handler": function (response) {
          alert(response.razorpay_payment_id);
          alert(response.razorpay_order_id);
          alert(response.razorpay_signature);
        },
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "theme": {
          "color": "#F37254"
        }
      };
      var rzp1 = new Razorpay(options);
      document.getElementById('rzp-button1').onclick = function (e) {
        rzp1.open();
        e.preventDefault();
      }
    </script>
  ```

  ```html Manual checkout with Callback URL theme={null}
  <button id = "rzp-button1"> Pay </button>
    <script src = "https://checkout.razorpay.com/v1/checkout.js"> </script>
    <script>
      var options = {
        "key": "[YOUR_KEY_ID]",
        "order_id": "order_1Aa00000000001",
        "customer_id": "cust_1Aa00000000001",
        "recurring": true,
        "callback_url": "https://eneqd3r9zrjok.x.pipedream.net/",
        "notes":{
            "note_key_1":"September",
            "note_key_2":"Make it so."
        },
        "theme": {
          "color": "#F37254"
        }
      };
      var rzp1 = new Razorpay(options);
      document.getElementById('rzp-button1').onclick = function (e) {
        rzp1.open();
        e.preventDefault();
      }
    </script>
  ```
</Note>

<AccordionGroup>
  <Accordion title="Additional Checkout Fields">
    You should send the following additional parameters along with the existing checkout options as a part of the authorisation transaction.

    `customer_id` *mandatory*
    : `string` Unique identifier of the customer created in the [first step](#111-create-a-customer).

    `order_id` *mandatory*
    : `string` Unique identifier of the  order created in the [second step](#112-create-an-order).

    `recurring` *mandatory*
    : `boolean` Possible values:

    * `true`: Recurring payment is enabled.
    * `false`: Recurring payment is not enabled.

    <Info>
      **Handy Tips**

      The `recurring` parameter also supports the value `preferred`. Use this when you want to support recurring payments and one-time payment in the same flow.
    </Info>
  </Accordion>
</AccordionGroup>

After this step, you can proceed to integrate with the [Fetch Token API](/docs/api/payments/recurring-payments/cards/tokens).

## 1.2. Using a Registration Link

Registration Link is an alternate way of creating an authorisation transaction. You can create a registration link using the API or [Dashboard](/docs/payments/recurring-payments/create#1-create-a-registration-link).

* You do not have to create a customer if you choose the registration link method for creating an authorisation transaction.

* When you create a registration link, an [invoice](/docs/payments/invoices) is automatically issued to the customer. They can use this invoice to make the authorisation payment.

* A registration link should always have an order amount (in subunits) the customer will be charged when making the authorisation payment. For cards, the amount should be <currency MY="0.10" IN="1" SG="0.5" US="1" /> in the case of cards.

<Info>
  **Handy Tips**

  You can [use Webhooks to get notifications about successful payments](/docs/api/payments/recurring-payments/webhooks#check-authorization-link-status-using-webhooks) against a registration link.
</Info>

### 1.2.1. Create a Registration Link

The following endpoint creates a registration link.

`POST /subscription_registration/auth_links`

```bash Curl theme={null}
curl -u <YOUR_KEY_ID>:<YOUR_KEY_SECRET>
-X POST https://api.razorpay.com/v1/subscription_registration/auth_links
-H "Content-Type: application/json" \
-d '{
  "customer":{
    "name":"<name>",
    "email":"<email>",
    "contact":"<phone>"
  },
  "type":"link",
  "amount":"100",
  "currency":"INR",
  "description":"Registration Link for <name>",
  "subscription_registration":{
    "method":"card",
    "max_amount":"1000000",
    "expire_at":1609423824,
    "frequency": "monthly"
  },
  "receipt":"Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1580479824,
  "notes":{
    "note_key 1":"Beam me up Scotty",
    "note_key 2":"Tea. Earl Gray. Hot."
  }
}'

```

```java Java theme={null}
RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

JSONObject registrationLinkRequest = new JSONObject();
JSONObject customer = new JSONObject();
customer.put("name","<name>");
customer.put("email","<email>");
customer.put("contact","<phone>");
registrationLinkRequest.put("customer", customer);
registrationLinkRequest.put("type", "link");
registrationLinkRequest.put("amount", 100);
registrationLinkRequest.put("currency", "INR");
registrationLinkRequest.put("description", "Registration Link for <name>");
JSONObject subscriptionRegistration = new JSONObject();
subscriptionRegistration.put("method","card");
subscriptionRegistration.put("max_amount",1000000);
subscriptionRegistration.put("expire_at",1609423824);
subscriptionRegistration.put("frequency","monthly");
registrationLinkRequest.put("subscription_registration", subscriptionRegistration);
registrationLinkRequest.put("receipt", "Receipt No. 1");
registrationLinkRequest.put("email_notify", true);
registrationLinkRequest.put("sms_notify", true);
registrationLinkRequest.put("expire_by", 1580479824);
JSONObject notes = new JSONObject();
notes.put("notes_key_1","Tea, Earl Grey, Hot");
notes.put("notes_key_2","Tea, Earl Grey… decaf.");
registrationLinkRequest.put("notes", notes);

Invoice invoice = razorpay.invoices.createRegistrationLink(registrationLinkRequest);

```

```php PHP theme={null}
$api = new Api($key_id, $secret);

$api->subscription->createSubscriptionRegistration(array('customer'=>array('name'=>'<name>','email'=>'<email>','contact'=>'<phone>'),'type'=>'link','amount'=>100,'currency'=>'INR','description'=>'Registration Link for <name>','subscription_registration'=>array('method'=>'card','max_amount'=>'1000000','expire_at'=>'1634215992','frequency'=>'monthly'),'receipt'=>'Receipt No. 5','email_notify'=> true,'sms_notify'=>true,'expire_by'=>1634215992, 'notes'=> array('note_key 1'=> 'Beam me up Scotty','note_key 2'=> 'Tea. Earl Gray. Hot.')));
```

```javascript Node.js theme={null}
var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

instance.subscriptions.createRegistrationLink({
  customer: {
    name: "<name>",
    email: "<email>",
    contact: "<phone>"
  },
  type: "link",
  amount: 100,
  currency: "INR",
  description: "Registration Link for <name>",
  subscription_registration: {
    method: "card",
    max_amount: 1000000,
    expire_at: 1609423824,
    frequency: "monthly"
  },
  receipt: "Receipt No. 1",
  email_notify: true,
  sms_notify: true,
  expire_by: 1580479824,
  notes: {
    notes_key_1: "Tea, Earl Grey, Hot",
    notes_key_2: "Tea, Earl Grey... decaf."
  }
})
```

```python Python theme={null}
client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

client.registration_link.create({
    'customer': {'name': '<name>',
                 'email': '<email>',
                 'contact': '<phone>'},
    'type': 'link',
    'amount': '100',
    'currency': 'INR',
    'description': 'Registration Link for Gaurav',
    'subscription_registration': {'method': 'card', 'max_amount': '1000000'
                                  , 'expire_at': 1644737663, 'frequency': 'monthly'},
    'receipt': 'Receipt No. #11',
    'email_notify': True,
    'sms_notify': True,
    'expire_by': 1644737663,
    'notes': {'note_key 1': 'Beam me up Scotty',
              'note_key 2': 'Tea. Earl Gray. Hot.'}
    })

```

```ruby Ruby theme={null}
require "razorpay"
Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

para_attr = {
  "customer":{
    "name": "<name>",
    "email": "<email>",
    "contact": "<phone>"
  },
  "type": "link",
  "amount": "100",
  "currency": "INR",
  "description": "Registration Link for <name>",
  "subscription_registration":{
    "method": "card",
    "max_amount": "1000000",
    "expire_at": 1609423824,
    "frequency": "monthly"
  },
  "receipt": "Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1580479824,
  "notes":{
    "note_key 1": "Beam me up Scotty",
    "note_key 2": "Tea. Earl Gray. Hot."
  }
}

Razorpay::SubscriptionRegistration.create(para_attr)

```

```go Go theme={null}
import ( razorpay "github.com/razorpay/razorpay-go" )
client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

data:= map[string]interface{}{
  "customer":map[string]interface{}{
    "name":"<name>",
    "email":"<email>",
    "contact":"<phone>",
  },
  "type":"link",
  "amount":"100",
  "currency":"INR",
  "description":"Registration Link for <name>",
  "subscription_registration":map[string]interface{}{
    "method":"card",
    "max_amount":"1000000",
    "expire_at":1609423824,
    "frequency": "monthly"
  },
  "receipt":"Receipt No. 1",
  "email_notify": true,
  "sms_notify": true,
  "expire_by":1681987284,
  "notes":map[string]interface{}{
    "note_key 1":"Beam me up Scotty",
    "note_key 2":"Tea. Earl Gray. Hot.",
  },
}

body, err := client.Invoice.CreateRegistrationLink(data, nil)

```

```csharp .NET theme={null}
RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

Dictionary<string, object> registrationLinkRequest = new Dictionary<string, object>();
Dictionary<string, object> customer = new Dictionary<string, object>();
customer.Add("name", "<name>");
customer.Add("email", "<email>");
customer.Add("contact", "<phone>");
registrationLinkRequest.Add("customer", customer);
registrationLinkRequest.Add("type", "link");
registrationLinkRequest.Add("amount", 100);
registrationLinkRequest.Add("currency", "INR");
registrationLinkRequest.Add("description", "Registration Link for <name>");
Dictionary<string, object> subscriptionRegistration = new Dictionary<string, object>();
subscriptionRegistration.Add("method", "card");
subscriptionRegistration.Add("max_amount", 1000000);
subscriptionRegistration.Add("expire_at", 1609423824);
registrationLinkRequest.Add("subscription_registration", subscriptionRegistration);
registrationLinkRequest.Add("receipt", "Receipt No. #18d");
registrationLinkRequest.Add("email_notify", true);
registrationLinkRequest.Add("sms_notify", true);
registrationLinkRequest.Add("expire_by", 1580479824);
Dictionary<string, object> notes = new Dictionary<string, object>();
notes.Add("notes_key_1", "Tea, Earl Grey, Hot");
notes.Add("notes_key_2", "Tea, Earl Grey… decaf.");
registrationLinkRequest.Add("notes", notes);

Invoice invoice = client.Invoice.CreateRegistrationLink(registrationLinkRequest);
```

```json Response theme={null}
{
  "id": "inv_FHrXGIpd3N17DX",
  "entity": "invoice",
  "receipt": "Receipt No. 24",
  "invoice_number": "Receipt No. 24",
  "customer_id": "cust_BMB3EwbqnqZ2EI",
  "customer_details": {
    "id": "cust_BMB3EwbqnqZ2EI",
    "name": "<name>",
    "email": "<email>",
    "contact": "<phone>",
    "gstin": null,
    "billing_address": null,
    "shipping_address": null,
    "customer_name": "<name>",
    "customer_email": "<email>",
    "customer_contact": "<phone>"
  },
  "order_id": "order_FHrXGJNngJyEAe",
  "line_items": [],
  "payment_id": null,
  "status": "issued",
  "expire_by": 4102444799,
  "issued_at": 1595491014,
  "paid_at": null,
  "cancelled_at": null,
  "expired_at": null,
  "sms_status": "pending",
  "email_status": "pending",
  "date": 1595491014,
  "terms": null,
  "partial_payment": false,
  "gross_amount": 100,
  "tax_amount": 0,
  "taxable_amount": 0,
  "amount": 100,
  "amount_paid": 0,
  "amount_due": 100,
  "currency": "INR",
  "currency_symbol": "₹",
  "description": "Registration Link for <name>",
  "notes": {
    "note_key 1": "Beam me up Scotty",
    "note_key 2": "Tea. Earl Gray. Hot."
  },
  "comment": null,
  "short_url": "https://rzp.io/i/VSriCfn",
  "view_less": true,
  "billing_start": null,
  "billing_end": null,
  "type": "link",
  "group_taxes_discounts": false,
  "created_at": 1595491014,
  "idempotency_key": null
}
```

<AccordionGroup>
  <Accordion title="Request Parameters">
    `customer`
    : `object` Details of the customer to whom the registration link is sent.

    `name` *mandatory*
    : `string` Customer's name.

    `email` *mandatory*
    : `string` Customer's email address.

    `contact`*mandatory*
    : `integer` Customer's contact number.

    `type` *mandatory*
    : `string` In this case, the value is `link`.

    `amount` *mandatory*
    : `integer` The payment amount in the smallest currency sub-unit.

    `currency` *mandatory*
    : `string` The 3-letter ISO currency code for the payment.

    `description` *mandatory*
    : `string` A description that appears on the hosted page.

    `subscription_registration`
    : `object` Details of the authorisation transaction.

    `method` *mandatory*
    : `string` The authorisation method. Here it is `card`.

    `max_amount` *mandatory*
    : `integer` The maximum amount that can be auto-debited in a single charge. The minimum value is `100` (₹1) and the maximum value is `100000000` (₹10,00,000). For an amount higher than this or the RBI limit of ₹15,000 (`1500000`) or ₹1,00,000 (`10000000`) respectively, the cardholder should provide an Additional Factor of Authentication (AFA) as per RBI guidelines.

    `expire_at` *optional*
    : `integer` The Unix timestamp till when you can use the token (authorisation on the payment method) to charge the customer subsequent payments. The card's expiry year is considered a default value.

    `frequency` *mandatory*
    : `string` The frequency at which you can charge your customer. Possible values:

    * `weekly`
    * `monthly`
    * `yearly`
    * `as_presented`

    `sms_notify` *optional*
    : `boolean` Indicates if SMS notifications are to be sent by Razorpay. Possible values:

    * `true` (default): Notifications are sent by Razorpay .
    * `false`: Notifications are not sent by Razorpay.

    `email_notify` *optional*
    : `boolean` Indicates if email notifications are to be sent by Razorpay. Possible values:

    * `true` (default): Notifications are sent by Razorpay .
    * `false`: Notifications are not sent by Razorpay.

    `expire_by` *optional*
    : `integer` The Unix timestamp indicates the expiry of the registration link.

    `receipt` *optional*
    : `string` A unique identifier entered by you for the order. For example, `Receipt No. 1`. You should map this parameter to the `order_id` sent by Razorpay.

    `notes` *optional*
    : `object` This is a key-value pair that is used to store additional information about the entity. Maximum 15 key-value pairs, 256 characters (maximum) each. For example, `"note_key": "Beam me up Scotty”`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameters">
    `id`
    : `string` The unique identifier of the invoice.

    `entity`
    : `string` The entity that has been created. Here, it is `invoice`.

    `receipt`
    : `string` A user-entered unique identifier of the invoice.

    `invoice_number`
    : `string` Unique number you added for internal reference.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_BMB3EwbqnqZ2EI`.

    `customer_details`
    : `object` Details of the customer.

    `id`
    : `string` The unique identifier associated with the customer to whom the invoice has been issued.

    `name`
    : `string` The customer's name.

    `email`
    : `string` The customer's email address.

    `contact`
    : `integer` The customer's phone number.

    `billing_address`
    : `string` Details of the customer's billing address.

    `shipping_address`
    : `string` Details of the customer's shipping address.

    `order_id`
    : `string` The unique identifier of the order associated with the invoice.

    `line_items`
    : `string` Details of the line item that is billed in the invoice. Maximum of 50 line items are allowed.

    `payment_id`
    : `string` Unique identifier of a payment made against the invoice.

    `status`
    : `string` The status of the invoice. Possible values:

    * `draft`
    * `issued`
    * `partially_paid`
    * `paid`
    * `cancelled`
    * `expired`
    * `deleted`

    `expire_by`
    : `integer` The Unix timestamp at which the invoice will expire.

    `issued_at`
    : `integer` The Unix timestamp at which the invoice was issued to the customer.

    `paid_at`
    : `integer` The Unix timestamp at which the payment was made.

    `cancelled_at`
    : `integer` The Unix timestamp at which the invoice was cancelled.

    `expired_at`
    : `integer` The Unix timestamp at which the invoice expired.

    `sms_status`
    : `string` The delivery status of the SMS notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `email_status`
    : `string` The delivery status of the email notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `date`
    : `integer` Timestamp, in Unix format, that indicates the issue date of the invoice.

    `terms`
    : `string` Any terms to be included in the invoice. Maximum of 2048 characters.

    `partial_payment`
    : `boolean` Indicates whether the customer can make a partial payment on the invoice. Possible values:

    * `true`:  The customer can make partial payments.
    * `false` (default): The customer cannot make partial payments.

    `amount`
    : `integer` Amount to be paid using the invoice. Must be in the smallest unit of the currency. For example, if the amount to be received from the customer is <currency MY="299.95" IN="299.95" SG="299.95" US="299.95" />, pass the value as `29995`.

    `amount_paid`
    : `integer` Amount paid by the customer against the invoice.

    `amount_due`
    : `integer` The remaining amount to be paid by the customer for the issued invoice.

    `currency`
    : `string` The currency associated with the invoice.

    `description`
    : `string`  A brief description of the invoice.

    `notes`
    : `object` Any custom notes added to the invoice. Maximum of 2048 characters.

    `short_url`
    : `string` The short URL that is generated. This is the link that can be shared with the customer to receive payments.

    `type`
    : `string` Here, it is `invoice`.

    `comment`
    : `string` Any comments to be added in the invoice. Maximum of 2048 characters.
  </Accordion>
</AccordionGroup>

### 1.2.2. Send/Resend Notifications

The following endpoint sends/resends notifications with the short URL to the customer:

`POST /invoices/:id/notify_by/:medium`

<AccordionGroup>
  <Accordion title="Sample Code">
    ```bash Curl theme={null}
     curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET]
     -X POST https://api.razorpay.com/v1/invoices/inv_1Aa00000000001/notify_by/sms

    ```

    ```java Java theme={null}
    RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    String invoiceId = "inv_1Aa00000000001";

    String medium = "sms";

    Invoice invoice = razorpay.invoices.notifyBy(invoiceId, medium);

    ```

    ```php PHP theme={null}
    $api = new Api($key_id, $secret);

    $api->invoice->fetch($invoiceId)->notify($medium);

    ```

    ```javascript Node.js theme={null}
    var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

    instance.invoices.notifyBy(invoiceId, medium)


    ```

    ```python Python theme={null}
    client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

    client.invoice.notify_by(invoiceId, medium)

    ```

    ```ruby Ruby theme={null}
    require "razorpay"
    Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

    invoiceId = "inv_JDdNb4xdf4gxQ7"

    medium = "email" 

    Razorpay::Invoice.notify_by(invoiceId, medium)

    ```

    ```go Go theme={null}
    import ( razorpay "github.com/razorpay/razorpay-go" )
    client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

    body, err := client.Invoice.Notify("<invoiceId>", "<medium>", nil, nil)

    ```

    ```csharp .NET theme={null}
    RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    string invoiceId = "inv_Z6t7VFTb9xHeOs";

    string medium = "sms";

    Invoice invoice = client.Invoice.Fetch(invoiceId).NotifyBy(medium);
    ```

    ```json Response theme={null}
    {
      "success": true
    }
    ```
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Path Parameters">
    `id`*mandatory*
    : `string` The unique identifier of the invoice linked to the registration link for which you want to send the notification. For example, `inv_1Aa00000000001`.

    `medium` *mandatory*
    : `string` Determines through which medium you want to resend the notification. Possible values:

    * `sms`
    * `email`
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameter">
    `success`
    : `boolean` Indicates whether the notifications were sent successfully. Possible values:

    * `true`: The notifications were successfully sent via SMS, email or both.
    * `false`: The notifications were not sent.
  </Accordion>
</AccordionGroup>

### 1.2.3. Cancel a Registration Link

The following endpoint cancels a registration link.

`POST /invoices/:id/cancel`

<Info>
  **Handy Tips**

  You can only cancel registration link in the `issued` state.
</Info>

<AccordionGroup>
  <Accordion title="Sample Code">
    ```bash Curl theme={null}
     curl -u [YOUR_KEY_ID]:[YOUR_KEY_SECRET]
     -X POST https://api.razorpay.com/v1/invoices/inv_1Aa00000000001/cancel

    ```

    ```java Java theme={null}
    RazorpayClient razorpay = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    String invoiceId = "inv_1Aa00000000001";

    Invoice invoice = razorpay.invoices.cancel(invoiceId);

    ```

    ```php PHP theme={null}
    $api = new Api($key_id, $secret);

    $api->invoice->fetch($invoiceId)->cancel();
    ```

    ```javascript Node.js theme={null}
    var instance = new Razorpay({ key_id: 'YOUR_KEY_ID', key_secret: 'YOUR_SECRET' })

    instance.invoices.cancel(invoiceId)

    ```

    ```python Python theme={null}
    client = razorpay.Client(auth=("YOUR_ID", "YOUR_SECRET"))

    client.invoice.cancel(invoiceId)

    ```

    ```ruby Ruby theme={null}
    require "razorpay"
    Razorpay.setup('YOUR_KEY_ID', 'YOUR_SECRET')

    invoiceId = "inv_1Aa00000000001"

    Razorpay::Invoice.cancel(invoiceId)

    ```

    ```go Go theme={null}
    import ( razorpay "github.com/razorpay/razorpay-go" )
    client := razorpay.NewClient("YOUR_KEY_ID", "YOUR_SECRET")

    body, err := client.Invoice.Cancel("<invoiceId>", nil, nil)

    ```

    ```csharp .NET theme={null}
    RazorpayClient client = new RazorpayClient("[YOUR_KEY_ID]", "[YOUR_KEY_SECRET]");

    string invoiceId = "inv_Z6t7VFTb9xHeOs";

    Invoice invoice = client.Invoice.Fetch(invoiceId).Cancel();
    ```

    ```json Response theme={null}
    {
      "id": "inv_FHrfRupD2ouKIt",
      "entity": "invoice",
      "receipt": "Receipt No. 1",
      "invoice_number": "Receipt No. 1",
      "customer_id": "cust_BMB3EwbqnqZ2EI",
      "customer_details": {
          "id": "cust_BMB3EwbqnqZ2EI",
          "name": "<name>",
          "email": "<email>",
          "contact": "<phone>",
          "gstin": null,
          "billing_address": null,
          "shipping_address": null,
          "customer_name": "<name>",
          "customer_email": "<email>",
          "customer_contact": "<phone>"
      },
      "order_id": "order_FHrfRw4TZU5Q2L",
      "line_items": [],
      "payment_id": null,
      "status": "cancelled",
      "expire_by": 4102444799,
      "issued_at": 1595491479,
      "paid_at": null,
      "cancelled_at": 1595491488,
      "expired_at": null,
      "sms_status": "sent",
      "email_status": "sent",
      "date": 1595491479,
      "terms": null,
      "partial_payment": false,
      "gross_amount": 100,
      "tax_amount": 0,
      "taxable_amount": 0,
      "amount": 100,
      "amount_paid": 0,
      "amount_due": 100,
      "currency": "INR",
      "currency_symbol": "₹",
      "description": "Registration Link for Gaurav Kumar",
      "notes": {
          "note_key 1": "Beam me up Scotty",
          "note_key 2": "Tea. Earl Gray. Hot."
      },
      "comment": null,
      "short_url": "https://rzp.io/i/QlfexTj",
      "view_less": true,
      "billing_start": null,
      "billing_end": null,
      "type": "link",
      "group_taxes_discounts": false,
      "created_at": 1595491480,
      "idempotency_key": null
    }

    ```
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Path Parameter">
    `id` *mandatory*
    : `string` The unique identifier for the invoice linked to the registration link that you want to cancel. For example, `inv_1Aa00000000001`.
  </Accordion>
</AccordionGroup>

<AccordionGroup>
  <Accordion title="Response Parameter">
    `id`
    : `string` The unique identifier of the invoice.

    `entity`
    : `string` The entity that has been created. Here, it is `invoice`.

    `receipt`
    : `string` A user-entered unique identifier of the invoice.

    `invoice_number`
    : `string` Unique number you added for internal reference.

    `customer_id`
    : `string` The unique identifier of the customer. For example, `cust_BMB3EwbqnqZ2EI`.

    `customer_details`
    : `object` Details of the customer.

    `id`
    : `string` The unique identifier associated with the customer to whom the invoice has been issued.

    `name`
    : `string` The customer's name.

    `email`
    : `string` The customer's email address.

    `contact`
    : `integer` The customer's phone number.

    `billing_address`
    : `string` Details of the customer's billing address.

    `shipping_address`
    : `string` Details of the customer's shipping address.

    `order_id`
    : `string` The unique identifier of the order associated with the invoice.

    `line_items`
    : `string` Details of the line item that is billed in the invoice. Maximum of 50 line items are allowed.

    `payment_id`
    : `string` Unique identifier of a payment made against the invoice.

    `status`
    : `string` The status of the invoice. Possible values:

    * `draft`
    * `issued`
    * `partially_paid`
    * `paid`
    * `cancelled`
    * `expired`
    * `deleted`

    `expire_by`
    : `integer` The Unix timestamp at which the invoice will expire.

    `issued_at`
    : `integer` The Unix timestamp at which the invoice was issued to the customer.

    `paid_at`
    : `integer` The Unix timestamp at which the payment was made.

    `cancelled_at`
    : `integer` The Unix timestamp at which the invoice was cancelled.

    `expired_at`
    : `integer` The Unix timestamp at which the invoice expired.

    `sms_status`
    : `string` The delivery status of the SMS notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `email_status`
    : `string` The delivery status of the email notification for the invoice sent to the customer. Possible values:

    * `pending`
    * `sent`

    `date`
    : `integer` Timestamp, in Unix format, that indicates the issue date of the invoice.

    `terms`
    : `string` Any terms to be included in the invoice. Maximum of 2048 characters.

    `partial_payment`
    : `boolean` Indicates whether the customer can make a partial payment on the invoice. Possible values:

    * `true`:  The customer can make partial payments.
    * `false` (default): The customer cannot make partial payments.

    `amount`
    : `integer` Amount to be paid using the invoice. Must be in the smallest unit of the currency. For example, if the amount to be received from the customer is <currency MY="299.95" IN="299.95" SG="299.95" US="299.95" />, pass the value as `29995`.

    `amount_paid`
    : `integer` Amount paid by the customer against the invoice.

    `amount_due`
    : `integer` The remaining amount to be paid by the customer for the issued invoice.

    `currency`
    : `string` The currency associated with the invoice.

    `description`
    : `string`  A brief description of the invoice.

    `notes`
    : `object` Any custom notes added to the invoice. Maximum of 2048 characters.

    `short_url`
    : `string` The short URL that is generated. This is the link that can be shared with the customer to receive payments.

    `type`
    : `string` Here, it is `invoice`.

    `comment`
    : `string` Any comments to be added in the invoice. Maximum of 2048 characters.
  </Accordion>
</AccordionGroup>

After this step, you can proceed to integrate with the [Fetch Token API](/docs/api/payments/recurring-payments/cards/tokens).
