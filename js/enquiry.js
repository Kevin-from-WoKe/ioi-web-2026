/*
// Captcha Script
//<form method="post" action="form-webmailContact.asp" name="form1" onsubmit="return checkform(this);">
function checkform(theform){
var why = "";

if(theform.CaptchaInput.value == ""){
why += "- Please Enter CAPTCHA Code.\n";
}
if(theform.CaptchaInput.value != ""){
if(ValidCaptcha(theform.CaptchaInput.value) == false){
why += "- The CAPTCHA Code Does Not Match.\n";
}
}
if(why != ""){
alert(why);
return false;
}
}

var a = Math.ceil(Math.random() * 9)+ '';
var b = Math.ceil(Math.random() * 9)+ '';
var c = Math.ceil(Math.random() * 9)+ '';
var d = Math.ceil(Math.random() * 9)+ '';
var e = Math.ceil(Math.random() * 9)+ '';

var code = a + b + c + d + e;
document.getElementById("txtCaptcha").value = code;
document.getElementById("CaptchaDiv").innerHTML = code;

// Validate input against the generated number
function ValidCaptcha(){
var str1 = removeSpaces(document.getElementById('txtCaptcha').value);
var str2 = removeSpaces(document.getElementById('CaptchaInput').value);
if (str1 == str2){
return true;
}else{
return false;
}
}

// Remove the spaces from the entered and generated code
function removeSpaces(string){
return string.split(' ').join('');
}
*/


// Validate input against the generated number
function ValidCaptcha(){
	var str1 = removeSpaces(document.getElementById('txtCaptcha').value);
	var str2 = removeSpaces(document.getElementById('CaptchaInput').value);
	if (str1 == str2){
		return true;
	}else{
		return false;
	}
}

// Remove the spaces from the entered and generated code
function removeSpaces(string){
	return string.split(' ').join('');
}


//$("form").submit(function(event){
	/*
	var strMsg = "";

	if($('#CaptchaInput').length > 0){
		if($('#CaptchaInput').val() == ''){
			strMsg += "- Please Enter CAPTCHA Code.\n";	
		}
		else{
			if(!ValidCaptcha($('#CaptchaInput').val())){
				strMsg += "- The CAPTCHA Code Does Not Match.\n";
			}
		}
	}

	if(strMsg != ""){
		alert(strMsg);
		return false;
	}
	*/
	
//	return submitToAPI(event);
	
//});
	let lenis;

$(function(){
	//var a = Math.ceil(Math.random() * 9)+ '';
	//var b = Math.ceil(Math.random() * 9)+ '';
	//var c = Math.ceil(Math.random() * 9)+ '';
	//var d = Math.ceil(Math.random() * 9)+ '';
	//var e = Math.ceil(Math.random() * 9)+ '';

	//var code = a + b + c + d + e;
	//document.getElementById("txtCaptcha").value = code;
	//document.getElementById("CaptchaDiv").innerHTML = code;
	

if (Webflow.env("editor") === undefined) {
  lenis = new Lenis({
    lerp: 0.1,
    wheelMultiplier: 1.5,
    gestureOrientation: "vertical",
    normalizeWheel: false,
    smoothTouch: false
  });
  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);
  const ro = new ResizeObserver(() => lenis.resize());
  ro.observe(document.body);
}
$("[data-lenis-start]").on("click", function () {
  lenis.start();
});
$("[data-lenis-stop]").on("click", function () {
  lenis.stop();
});
$("[data-lenis-toggle]").on("click", function () {
  $(this).toggleClass("stop-scroll");
  if ($(this).hasClass("stop-scroll")) {
    lenis.stop();
  } else {
    lenis.start();
  }
});
	
	var SITE_KEY = '6LeD3HMsAAAAAHCDu9iGC-YSptGeh_HuPjIx_CZS';
	var forms = document.querySelectorAll('form[action*="webmailContact"]');
	forms.forEach(function(form) {
		form.addEventListener('submit', function(e) {
			var tokenField = form.querySelector('#g-recaptcha-response');
			//if (!tokenField || tokenField.value) return; // token already set, allow submit
			e.preventDefault();
			//e.stopPropagation(); 
			
			try{
				grecaptcha.ready(function() {
					grecaptcha.execute(SITE_KEY, { action: 'contact' }).then(function(token) {
						tokenField.value = token ;
						
						
						return submitToAPI(e);
						//form.submit(); // native POST — ASP receives it normally
					});
				});
			
			}
			catch(exp)
			{
				console.log('Error: ' + exp.Message);
				return false;
			}
			
			
		});
	});
	
	
	let siteYearLabel = document.getElementById('siteYear');
	if(siteYearLabel)
	{
		siteYearLabel.innerText = new Date().getFullYear();
	}

	let langOpt = document.getElementById('lnkLangOpt');

	if(langOpt)
	{
		langOpt.style.display = 'none';
	}


});

function submitToAPI(e) {
	var blnSuccessAPI = false;
	
	var URL = "https://uudwr4nux0.execute-api.ap-southeast-1.amazonaws.com/APIStage/contactus";

		/*var Namere = /[A-Za-z]{1}[A-Za-z]/;
		if (!Namere.test($("#txtContactName").val())) {
					 alert ("Name can not less than 2 char");
			return;
		}
		var mobilere = /[0-9]{10}/;
		if (!mobilere.test($("#txtPhone").val())) {
			alert ("Please enter valid mobile number");
			return;
		}
		if ($("#txtEmail").val()=="") {
			alert ("Please enter your email id");
			return;
		}

		var reeamil = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,6})?$/;
		if (!reeamil.test($("#txtEmail").val())) {
			alert ("Please enter valid email address");
			return;
		}*/

	let data = {};

	var externalName = $("#Name").val();
	var externalCompany = $("#Company").val();
	var externalPhone = $("#Phone").val();
	var externalEmail = $("#Email").val();
	var externalCity = $("#City").val();
	var externalCountry = $("#Country").val();
	var internalCompany = ""//$("#selCompany").val();
	
	let enquiry = "";
	let productText ="";
	let products = [];
	
	data.name = externalName;
	data.company = externalCompany;
	data.phone = externalPhone;
	data.email = externalEmail;
	data.city = externalCity;
	data.country = externalCountry;
	data.internalCompany = internalCompany;
	
	let recaptchaToken = "";
	if($('#g-recaptcha-response').length > 0)
	{
		recaptchaToken = $('#g-recaptcha-response').val();
	}
	
	if($("input[name='Inquiry-Type']:checked").length > 0)
	{
		enquiry = $("input[name='Inquiry-Type']:checked").val();
	}
	
	
	if(enquiry)
	{
		if(enquiry === 'Product sourcing')
		{
			let productSelect = getCheckedLabels();
			productText = productSelect.fullText;
			products = productSelect.products;	
		}
	}
	
	
	var externalMsg = $("#Message").text();
	
	data.enquiry = enquiry;
	data.productText = productText;
	data.products = products;
	data.message = externalMsg;
	data.recaptchaToken = recaptchaToken ;
	data.Iswebflow = 1;

	
	var reeamil = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,6})?$/;
	var intToRecipient = 0;
	var intCcRecipient = 0;
	var intBccRecipient = 1;
	var emailSubject = "Enquiry Form";
	
	if(externalEmail !== ''){
		var externalEmails = externalEmail.split(/[;,]+/); 
		var extermalValidEmail = true;
		
		for (var iEmail in externalEmails) {
            var trimmedEmail = externalEmails[iEmail].trim();
            if (trimmedEmail !== "" ) { // Only validate non-empty strings
                if (!reeamil.test(trimmedEmail)) {
					extermalValidEmail = false;
				}
            }
        }
		
		if (!extermalValidEmail) {
			alert ("Please enter valid email address");
			return false;
		}
	}
	
	
	
	var emailContent = 'Contact Name : ' + externalName + '<br /><br />' +
		'Company : ' + externalCompany + '<br /><br />' +
		'Phone : ' + externalPhone + '<br /><br />' +
		'Email : ' + externalEmail + '<br /><br />' +
		'City : ' + externalCity + '<br /><br />' +
		'Country : ' + externalCountry + '<br /><br />' +
		'Enquiry : ' + enquiry + '<br /><br />' ;
		
		
	
	if(productText)
	{
			if(productText !== "")
			{
				emailContent = emailContent + 'Products : ' + productText + '<br /><br />' ;
			}
	}
	
	emailContent = emailContent + 'Message : ' + externalMsg + '<br /><br />' ;
	
	data.htmlContent = emailContent;
	

	
				
	if(enquiry === 'HR inquiries'){
		intToRecipient = 19
	}
	else if(enquiry === 'Product sourcing'){
		let hasFA = false;
		let hasEster = false;
		let hasSN = false;
		
		products.map(input => {
			if(input.productName.indexOf('Fatty Acids') >= 0 )
			{
				hasFA = true;
			}
			else if(input.productName.indexOf('Esters') >= 0 )
			{
				hasEster = true;
			}
			else if(input.productName.indexOf('Soap Noodles') >= 0)
			{
				hasSN = true;
			}
			
			
		});
		
		if(hasFA === true && hasEster === true && hasSN == true)
		{
			intToRecipient = 27;
		}
		else if(hasFA === true && hasEster === true && hasSN == false)
		{
			intToRecipient = 24;
		}
		else if(hasFA === true && hasEster === false && hasSN == true)
		{
			intToRecipient = 25;
		}
		else if(hasFA === false && hasEster === true && hasSN == true)
		{
			intToRecipient = 26;
		}
		else if(hasFA === true && hasEster === false && hasSN == false)
		{
			intToRecipient = 16;
		}
		else if(hasFA === false && hasEster === true && hasSN == false)
		{
			intToRecipient = 17;
		}
		else if(hasFA === false && hasEster === false && hasSN == true)
		{
			intToRecipient = 18;
		}
	}
	
	else if(enquiry === 'Sustainability'){
		intToRecipient = 20;
	}
	else if(enquiry === 'Others'){
		intToRecipient = 21;
	}
	else {
		alert('Please select enquiry.');
		return false;
	}
	
	data.toRecipient = intToRecipient;
	data.emailSubject= emailSubject;
	data.ccRecipient = intCcRecipient;
	data.bccRecipient = intBccRecipient;
	
	
	//return false;
	/*
	var data = {
		toRecipient : intToRecipient,
		ccRecipient : intCcRecipient,
		bccRecipient : intBccRecipient,
		emailSubject : emailSubject,
		htmlContent : emailContent
	};
	*/
	
	
	try{
		$.ajax({
			type: "POST",
			url :URL,
			dataType: "json",
			/*crossDomain: "true",*/
			contentType: "application/json; charset=utf-8",
			async: false,
			cache: false,
			data: JSON.stringify(data),
			success: function (returnedData, textStatus, jqXHR) {
			// clear form and show a success message
				
				var intStatus = 400;
				var objReturnedMsg = null;
				var strReturnedMsg = '';
				var objReturnedData = null;
				
				if(returnedData){
					objReturnedData = returnedData;
				}
				
				
				if(objReturnedData ){
					if(objReturnedData.statusCode){
						intStatus = objReturnedData.statusCode;
						
						if(objReturnedData.body){
							if(objReturnedData.body.trim() !==''){
								objReturnedMsg = JSON.parse(objReturnedData.body);
							
								if(objReturnedMsg){
									if(objReturnedMsg.message){
										strReturnedMsg = objReturnedMsg.message;
									}
									
									if(objReturnedMsg.error){
										strReturnedMsg = objReturnedMsg.error;
									}
									
								}
							}
						}
					}
					else{
						intStatus = 500;
						
						if(objReturnedData.errorMessage){
							
							if(objReturnedData.errorType){
								if(objReturnedData.errorType === "Sandbox.Timedout"){
									strReturnedMsg = "Verification timed out. Please try again.";
								}
								else{
									strReturnedMsg = objReturnedData.errorMessage;
								}
								
							}
			
						}
						else{
							strReturnedMsg = 'Failed to proceess.';
						}
						
					}
					
					
				}
				
				console.log('Returned response : status: ' +  intStatus.toString() + ', message: ' + strReturnedMsg );
			
				blnSuccessAPI = true;
				if(intStatus >= 400 && intStatus < 600 ){
					alert(strReturnedMsg)
					return false;
				}
				else {
					
					alert('Your information has been submitted.')
					location.reload();
					return false;
				}
					
			},
			error: AjaxOnError
		});
	}
	catch(exAPI){
		console.error("An error occurred:", exAPI.message);
	}
	
	if(!blnSuccessAPI){
		//Back to old method
		//return true;
		return false; //no longer used asp
		
	}
	else{
		e.preventDefault();
		return false;
	}
 }
	 
function AjaxOnError(xhr, errorType, exception) {
	var responseText = '';
	var strAlert = '';

	if(xhr && xhr.responseText){
		responseText = $.parseJSON(xhr.responseText);
		strAlert = errorType + ' ' + exception + '\n' +
		responseText.Message + '\n' +
		responseText.ExceptionType + '\n' +
		responseText.StackTrace + '\n';
	}
	else{
		strAlert = errorType + ' ' + exception + '\n';
	}

	alert(strAlert);

}


function getCheckedLabels() {
  const checkedInputs = document.querySelectorAll('.productOption input[type="checkbox"]:checked');

	
	let arryDataProduct = [];
	

  const results = Array.from(checkedInputs).map(input => {
    const label = input.closest('label');

    const mainText = label.querySelector('.form_checkbox-label')?.textContent.trim() || '';
    const subText = label.querySelector('.margin-xxsmall')?.textContent.trim() || '';
	let dataProduct = {};
	dataProduct.productName = `${mainText} - ${subText}`;
	
	arryDataProduct.push(dataProduct);

    return `${mainText} - ${subText}`;
  });



  return { fullText: results.join(', '), products: arryDataProduct };
}

